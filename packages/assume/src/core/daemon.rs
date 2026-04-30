use crate::core::config::{self, Config};
use crate::core::keychain;
use crate::plugin::registry::PluginRegistry;
use crate::plugin::{AuthTokens, Context, Credentials, ProviderError};
use anyhow::{Context as _, Result};
use chrono::Utc;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Per-provider state managed by the daemon
#[derive(Debug, Clone)]
pub enum PluginStatus {
    /// Healthy, tokens loaded, may or may not have active context
    Active,
    /// Needs user to run `gs-assume login <provider>`
    NeedsLogin,
    /// Plugin failed validation or is in a broken state
    #[allow(dead_code)]
    Broken(String),
}

#[derive(Debug, Clone)]
pub struct PluginState {
    pub status: PluginStatus,
    pub tokens: Option<AuthTokens>,
    pub active_context: Option<Context>,
    pub contexts: Vec<Context>,
    pub credential_cache: HashMap<String, Credentials>,
    pub pinned_sessions: HashMap<String, Context>,
}

impl Default for PluginState {
    fn default() -> Self {
        Self {
            status: PluginStatus::NeedsLogin,
            tokens: None,
            active_context: None,
            contexts: Vec::new(),
            credential_cache: HashMap::new(),
            pinned_sessions: HashMap::new(),
        }
    }
}

/// Shared daemon state accessible from RPC handlers and refresh loop
pub struct DaemonState {
    #[allow(dead_code)]
    pub config: Config,
    pub registry: PluginRegistry,
    pub plugin_states: HashMap<String, PluginState>,
}

pub type SharedDaemonState = Arc<RwLock<DaemonState>>;

impl DaemonState {
    pub fn new(config: Config, registry: PluginRegistry) -> Self {
        let mut plugin_states = HashMap::new();
        for id in registry.ids() {
            let mut state = PluginState::default();
            // Try to load tokens from keychain
            match keychain::load_tokens(&id) {
                Ok(Some(tokens)) => {
                    if tokens.refresh_expires_at > Utc::now() {
                        state.tokens = Some(tokens);
                        state.status = PluginStatus::Active;
                    } else {
                        tracing::info!("Refresh token expired for {id}, needs re-login");
                        state.status = PluginStatus::NeedsLogin;
                    }
                }
                Ok(None) => {
                    state.status = PluginStatus::NeedsLogin;
                }
                Err(e) => {
                    tracing::warn!("Failed to load tokens for {id}: {e}");
                    state.status = PluginStatus::NeedsLogin;
                }
            }
            // Load cached contexts so the credential endpoint can resolve context IDs
            if let Some(contexts) = crate::core::cache::load_contexts(&id) {
                state.contexts = contexts;
                tracing::info!("Loaded {} cached contexts for {id}", state.contexts.len());
            }
            // Load active context from cache
            if let Some(active) = crate::core::cache::load_active_context() {
                if active.provider_id == id {
                    state.active_context = Some(active);
                }
            }
            plugin_states.insert(id, state);
        }
        Self {
            config,
            registry,
            plugin_states,
        }
    }
}

/// Check if a PID belongs to a gs-assume process by examining the process name.
/// Uses `ps -p <pid> -o comm=` which works on both macOS and Linux.
/// On Linux, comm is truncated to 15 chars (kernel TASK_COMM_LEN limit),
/// which is fine for "gs-assume" (9 chars).
fn pid_belongs_to_gs_assume(pid: i32) -> bool {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let comm = String::from_utf8_lossy(&out.stdout);
            let comm = comm.trim();
            // Accept both "gs-assume" and "gsa" (symlinked binary name)
            comm == "gs-assume" || comm == "gsa"
        }
        _ => {
            // If ps fails, be conservative and return false
            false
        }
    }
}

/// Check if the daemon is already running by examining the PID file
pub fn is_daemon_running() -> bool {
    let pid_file = config::pid_path();
    if !pid_file.exists() {
        return false;
    }
    match std::fs::read_to_string(&pid_file) {
        Ok(content) => {
            if let Ok(pid) = content.trim().parse::<i32>() {
                // Check if process is alive using nix
                use nix::sys::signal;
                use nix::unistd::Pid;
                let signal_ok = signal::kill(Pid::from_raw(pid), None).is_ok();
                // Also verify process identity to avoid recycled PID issues
                signal_ok && pid_belongs_to_gs_assume(pid)
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

/// Action to take when serving, based on current daemon state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServeAction {
    /// Daemon is running and healthy — exit 0, no-op
    NoopHealthy,
    /// PID file exists but process is not gs-assume or not healthy — remove stale PID and start
    RemoveStalePidAndStart,
    /// No PID file — start fresh
    StartFresh,
}

/// Determine the action to take when `gs-assume serve` is invoked.
/// This is extracted as a pure function for testability.
pub fn serve_action_for_current_state() -> ServeAction {
    let pid_file = config::pid_path();
    if !pid_file.exists() {
        return ServeAction::StartFresh;
    }

    match std::fs::read_to_string(&pid_file) {
        Ok(content) => {
            if let Ok(pid) = content.trim().parse::<i32>() {
                use nix::sys::signal;
                use nix::unistd::Pid;

                // Check if process is alive
                let signal_ok = signal::kill(Pid::from_raw(pid), None).is_ok();

                if signal_ok {
                    // Process exists — verify it's actually gs-assume
                    if pid_belongs_to_gs_assume(pid) {
                        // It's gs-assume — check if healthy
                        if is_daemon_healthy() {
                            ServeAction::NoopHealthy
                        } else {
                            // Process exists but not responding to health check
                            ServeAction::RemoveStalePidAndStart
                        }
                    } else {
                        // PID belongs to a different process (recycled)
                        ServeAction::RemoveStalePidAndStart
                    }
                } else {
                    // Process doesn't exist
                    ServeAction::RemoveStalePidAndStart
                }
            } else {
                // Invalid PID in file
                ServeAction::RemoveStalePidAndStart
            }
        }
        Err(_) => ServeAction::RemoveStalePidAndStart,
    }
}

/// Truncate an oversized log file to prevent unbounded growth.
/// Returns Ok(()) on success or if the file doesn't exist.
/// Logs warnings on failure but doesn't fail.
pub fn truncate_oversized_log(path: &Path, max_bytes: u64) -> Result<()> {
    match std::fs::metadata(path) {
        Ok(metadata) => {
            if metadata.len() > max_bytes {
                tracing::info!("Truncating oversized log file: {} bytes", metadata.len());
                // Truncate by opening with truncate=true
                match std::fs::OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(path)
                {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        tracing::warn!("Failed to truncate log file {}: {e}", path.display());
                        Ok(()) // Best-effort: continue even if truncate fails
                    }
                }
            } else {
                Ok(())
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // File doesn't exist — that's fine
            Ok(())
        }
        Err(e) => {
            tracing::warn!("Failed to stat log file {}: {e}", path.display());
            Ok(()) // Best-effort: continue even if stat fails
        }
    }
}

/// Write PID file for the current process
pub fn write_pid_file() -> Result<()> {
    let pid_file = config::pid_path();
    config::ensure_config_dir()?;
    std::fs::write(&pid_file, std::process::id().to_string())
        .with_context(|| format!("Failed to write PID file: {}", pid_file.display()))?;
    Ok(())
}

/// Remove PID file
pub fn remove_pid_file() {
    let pid_file = config::pid_path();
    let _ = std::fs::remove_file(&pid_file);
}

/// Remove the daemon socket file
pub fn remove_socket_file() {
    let sock = config::socket_path();
    let _ = std::fs::remove_file(&sock);
}

/// The unified refresh loop. Runs as a background task, iterating over all
/// registered plugins on each tick.
pub async fn run_refresh_loop(state: SharedDaemonState) {
    // Use the smallest check_interval across all plugins
    let check_interval = {
        let s = state.read().await;
        let mut min_interval = std::time::Duration::from_secs(60);
        for provider in s.registry.list() {
            let schedule = provider.refresh_schedule();
            if schedule.check_interval < min_interval {
                min_interval = schedule.check_interval;
            }
        }
        min_interval
    };

    let mut interval = tokio::time::interval(check_interval);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        let provider_ids: Vec<String> = {
            let s = state.read().await;
            s.registry.ids()
        };

        for provider_id in &provider_ids {
            if let Err(e) = refresh_provider(&state, provider_id).await {
                tracing::warn!("Refresh failed for {provider_id}: {e}");
            }
        }
    }
}

/// Helper to fetch credentials for the active context.
/// Returns Ok(Some(creds)) on success, Ok(None) if no active context,
/// and Err(ProviderError) on failure.
async fn fetch_credentials_for_active_context(
    state: &SharedDaemonState,
    provider_id: &str,
    active_ctx: &Context,
    tokens: &AuthTokens,
) -> Result<Option<Credentials>, ProviderError> {
    let provider = {
        let s = state.read().await;
        match s.registry.get(provider_id) {
            Some(p) => Arc::clone(p),
            None => return Ok(None),
        }
    };

    let fetch_timeout = std::time::Duration::from_secs(15);
    let fetch_result =
        tokio::time::timeout(fetch_timeout, provider.get_credentials(tokens, active_ctx)).await;

    match fetch_result {
        Err(_) => {
            tracing::warn!("Credential fetch timed out for {provider_id}");
            Ok(None) // Timeout — will retry next tick
        }
        Ok(Ok(creds)) => Ok(Some(creds)),
        Ok(Err(e)) => Err(e),
    }
}

/// Refresh a single provider's credentials and tokens
async fn refresh_provider(state: &SharedDaemonState, provider_id: &str) -> Result<()> {
    let (provider, plugin_state) = {
        let s = state.read().await;
        let provider = match s.registry.get(provider_id) {
            Some(p) => Arc::clone(p),
            None => return Ok(()),
        };
        let plugin_state = match s.plugin_states.get(provider_id) {
            Some(ps) => ps.clone(),
            None => return Ok(()),
        };
        (provider, plugin_state)
    };

    // Skip if not active
    match &plugin_state.status {
        PluginStatus::Broken(_) | PluginStatus::NeedsLogin => return Ok(()),
        PluginStatus::Active => {}
    }

    let tokens = match &plugin_state.tokens {
        Some(t) => t.clone(),
        None => return Ok(()),
    };

    let schedule = provider.refresh_schedule();
    let now = Utc::now();
    let buffer =
        chrono::Duration::from_std(schedule.refresh_buffer).unwrap_or(chrono::Duration::minutes(5));

    // 1. Check if active context's credentials need refresh
    if let Some(ref active_ctx) = plugin_state.active_context {
        let needs_cred_refresh = plugin_state
            .credential_cache
            .get(&active_ctx.id)
            .map(|cred| cred.expires_at - buffer < now)
            .unwrap_or(true);

        if needs_cred_refresh {
            match fetch_credentials_for_active_context(state, provider_id, active_ctx, &tokens)
                .await
            {
                Ok(Some(creds)) => {
                    let mut s = state.write().await;
                    if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                        ps.credential_cache.insert(active_ctx.id.clone(), creds);
                    }
                    tracing::debug!("Refreshed credentials for {provider_id}:{}", active_ctx.id);
                }
                Ok(None) => {
                    // Timeout or no active context — will retry next tick
                }
                Err(ProviderError::AccessTokenExpired) => {
                    // Fall through to session refresh below
                    // After successful session refresh, we'll retry credentials
                }
                Err(ProviderError::RefreshTokenExpired) => {
                    let display_name = provider.display_name().to_string();
                    {
                        let mut s = state.write().await;
                        if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                            ps.status = PluginStatus::NeedsLogin;
                        }
                    } // write lock dropped BEFORE notification
                    notify_session_expired(&display_name);
                    return Ok(());
                }
                Err(ProviderError::NetworkError(msg)) => {
                    tracing::warn!("Network error refreshing {provider_id}: {msg}");
                    return Ok(()); // Retry next tick
                }
                Err(ProviderError::ContextNotFound(msg)) => {
                    tracing::warn!("Context no longer valid for {provider_id}: {msg}");
                    let mut s = state.write().await;
                    if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                        ps.active_context = None;
                    }
                    return Ok(());
                }
                Err(e) => {
                    tracing::error!("Error refreshing credentials for {provider_id}: {e}");
                    return Ok(());
                }
            }
        }
    }

    // 2. Check if session token needs refresh
    if tokens.session_expires_at - buffer < now {
        let refresh_timeout = std::time::Duration::from_secs(15);
        let session_result = tokio::time::timeout(refresh_timeout, provider.refresh(&tokens)).await;
        match session_result {
            Err(_) => {
                tracing::warn!("Session refresh timed out for {provider_id}");
                // Retry next tick
            }
            Ok(Ok(new_tokens)) => {
                keychain::store_tokens(provider_id, &new_tokens)?;
                let mut s = state.write().await;
                if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                    ps.tokens = Some(new_tokens.clone());
                }
                tracing::info!("Session refreshed for {provider_id}");

                // After successful session refresh, retry credential fetch
                // if we have an active context that needs credentials
                if let Some(ref active_ctx) = plugin_state.active_context {
                    let needs_cred_refresh = plugin_state
                        .credential_cache
                        .get(&active_ctx.id)
                        .map(|cred| cred.expires_at - buffer < now)
                        .unwrap_or(true);

                    if needs_cred_refresh {
                        match fetch_credentials_for_active_context(
                            state,
                            provider_id,
                            active_ctx,
                            &new_tokens,
                        )
                        .await
                        {
                            Ok(Some(creds)) => {
                                let mut s = state.write().await;
                                if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                                    ps.credential_cache.insert(active_ctx.id.clone(), creds);
                                }
                                tracing::info!(
                                    "Refreshed credentials for {provider_id}:{} after session refresh",
                                    active_ctx.id
                                );
                            }
                            Ok(None) => {
                                // Timeout — will retry next tick
                            }
                            Err(ProviderError::AccessTokenExpired) => {
                                // Session was just refreshed, but credentials still expired
                                // This shouldn't happen — warn and retry next tick
                                tracing::warn!(
                                    "Credentials still expired after session refresh for {provider_id}"
                                );
                            }
                            Err(ProviderError::RefreshTokenExpired) => {
                                // Shouldn't happen since we just refreshed
                                tracing::warn!(
                                    "Refresh token expired immediately after refresh for {provider_id}"
                                );
                            }
                            Err(ProviderError::NetworkError(msg)) => {
                                tracing::warn!(
                                    "Network error fetching credentials after session refresh for {provider_id}: {msg}"
                                );
                            }
                            Err(ProviderError::ContextNotFound(msg)) => {
                                tracing::warn!(
                                    "Context no longer valid after session refresh for {provider_id}: {msg}"
                                );
                                let mut s = state.write().await;
                                if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                                    ps.active_context = None;
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Error fetching credentials after session refresh for {provider_id}: {e}"
                                );
                            }
                        }
                    }
                }
            }
            Ok(Err(ProviderError::RefreshTokenExpired)) => {
                tracing::warn!("Refresh token expired for {provider_id}");
                let display_name = provider.display_name().to_string();
                {
                    let mut s = state.write().await;
                    if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                        ps.status = PluginStatus::NeedsLogin;
                    }
                } // write lock dropped BEFORE notification
                notify_session_expired(&display_name);
            }
            Ok(Err(ProviderError::NetworkError(msg))) => {
                tracing::warn!("Network error during session refresh for {provider_id}: {msg}");
                // Retry next tick -- credentials may still be valid
            }
            Ok(Err(e)) => {
                tracing::error!("Error refreshing session for {provider_id}: {e}");
            }
        }
    }

    Ok(())
}

/// Start the credential HTTP endpoints for all registered plugins.
/// Returns the join handles for the spawned servers.
pub async fn start_credential_endpoints(
    state: SharedDaemonState,
) -> Result<Vec<tokio::task::JoinHandle<()>>> {
    let mut handles = Vec::new();
    let s = state.read().await;

    for provider in s.registry.list() {
        let endpoint = provider.credential_endpoint();
        let provider_id = provider.id().to_string();
        let state_clone = Arc::clone(&state);

        let handle = tokio::spawn(async move {
            if let Err(e) = serve_credential_endpoint(
                &provider_id,
                endpoint.port,
                &endpoint.path,
                endpoint.auth_mechanism,
                state_clone,
            )
            .await
            {
                tracing::error!("Credential endpoint for {provider_id} failed: {e}");
            }
        });
        handles.push(handle);

        tracing::info!(
            "Credential endpoint for {} on port {}",
            provider.id(),
            endpoint.port
        );
    }

    Ok(handles)
}

/// Serve a single provider's credential endpoint
async fn serve_credential_endpoint(
    provider_id: &str,
    port: u16,
    path: &str,
    auth: crate::plugin::EndpointAuth,
    state: SharedDaemonState,
) -> Result<()> {
    use http_body_util::Full;
    use hyper::body::Bytes;
    use hyper::server::conn::http1;
    use hyper::service::service_fn;
    use hyper::{Request, Response, StatusCode};
    use hyper_util::rt::TokioIo;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    let expected_path = path.to_string();
    let provider_id = provider_id.to_string();

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let state = Arc::clone(&state);
        let expected_path = expected_path.clone();
        let auth = auth.clone();
        let provider_id = provider_id.clone();

        tokio::spawn(async move {
            let service = service_fn(move |req: Request<hyper::body::Incoming>| {
                let state = Arc::clone(&state);
                let expected_path = expected_path.clone();
                let auth = auth.clone();
                let provider_id = provider_id.clone();

                async move {
                    // Accept both /credentials and /credentials/{context_id}
                    // Per-shell context: each shell sets AWS_CONTAINER_CREDENTIALS_FULL_URI
                    // to include its context ID in the path.
                    let path = req.uri().path().to_string();
                    let context_id = if path == expected_path {
                        // Legacy: /credentials — use the global active context
                        None
                    } else if let Some(id) = path.strip_prefix(&format!("{}/", expected_path)) {
                        // Per-shell: /credentials/{context_id}
                        if id.is_empty() {
                            None
                        } else {
                            Some(id.to_string())
                        }
                    } else {
                        return Ok::<_, hyper::Error>(
                            Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Full::new(Bytes::from("Not Found")))
                                .unwrap(),
                        );
                    };

                    // Check auth
                    let authed = match &auth {
                        crate::plugin::EndpointAuth::BearerToken { token } => req
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .map(|v| {
                                let v = v.strip_prefix("Bearer ").unwrap_or(v);
                                v == token.as_str()
                            })
                            .unwrap_or(false),
                        crate::plugin::EndpointAuth::RequiredHeader { key, value } => req
                            .headers()
                            .get(key.as_str())
                            .and_then(|v| v.to_str().ok())
                            .map(|v| v == value.as_str())
                            .unwrap_or(false),
                    };

                    if !authed {
                        return Ok(Response::builder()
                            .status(StatusCode::UNAUTHORIZED)
                            .body(Full::new(Bytes::from("Unauthorized")))
                            .unwrap());
                    }

                    // Serve credentials for the requested context.
                    // If cached, return immediately. If not cached but context is
                    // known, fetch on-demand so per-shell switching works without
                    // waiting for the refresh loop.

                    // Resolve target context ID and try cache (read lock)
                    let (target_ctx_id, cached_response) = {
                        let s = state.read().await;
                        let ps = s.plugin_states.get(&provider_id);

                        let resolved_id = context_id.or_else(|| {
                            ps.and_then(|p| p.active_context.as_ref().map(|c| c.id.clone()))
                        });

                        // Fallback: re-read active context from cache file in case
                        // gsa use was run after daemon startup. Use spawn_blocking to
                        // avoid blocking the tokio runtime with sync file I/O.
                        let resolved_id = if resolved_id.is_some() {
                            resolved_id
                        } else {
                            tokio::task::spawn_blocking(|| {
                                crate::core::cache::load_active_context().map(|c| c.id)
                            })
                            .await
                            .unwrap_or(None)
                        };

                        let cached = match (&resolved_id, ps) {
                            (Some(ctx_id), Some(ps)) => ps
                                .credential_cache
                                .get(ctx_id)
                                .filter(|creds| creds.expires_at > Utc::now())
                                .map(|creds| {
                                    Response::builder()
                                        .status(StatusCode::OK)
                                        .header("content-type", "application/json")
                                        .body(Full::new(Bytes::from(creds.payload.clone())))
                                        .unwrap()
                                }),
                            _ => None,
                        };

                        (resolved_id, cached)
                    };

                    let response = if let Some(resp) = cached_response {
                        // Cache hit — fast path
                        resp
                    } else if let Some(ref ctx_id) = target_ctx_id {
                        // Cache miss — fetch credentials on-demand
                        let fetch_result = {
                            let s = state.read().await;
                            let ps = s.plugin_states.get(&provider_id);
                            if let Some(ps) = ps {
                                let ctx = ps
                                    .contexts
                                    .iter()
                                    .find(|c| c.id == *ctx_id)
                                    .or(ps.active_context.as_ref())
                                    .cloned();
                                let tokens = ps.tokens.clone();
                                let provider = s.registry.get(&provider_id).map(Arc::clone);
                                (ctx, tokens, provider)
                            } else {
                                (None, None, None)
                            }
                        };

                        // Note: tokens/ctx are cloned from a read lock. If the refresh
                        // loop updates tokens between lock release and get_credentials,
                        // the provider will return AccessTokenExpired and we'll get a
                        // retry on next request. This is acceptable because holding the
                        // lock across the network call would block all other credential
                        // requests.
                        match fetch_result {
                            (Some(ctx), Some(tokens), Some(provider)) => {
                                let fetch_timeout = std::time::Duration::from_secs(15);
                                let fetch_future = provider.get_credentials(&tokens, &ctx);
                                match tokio::time::timeout(fetch_timeout, fetch_future).await {
                                    Ok(Ok(creds)) => {
                                        let payload = creds.payload.clone();
                                        let mut s = state.write().await;
                                        if let Some(ps) = s.plugin_states.get_mut(&provider_id) {
                                            ps.credential_cache.insert(ctx.id.clone(), creds);
                                        }
                                        Response::builder()
                                            .status(StatusCode::OK)
                                            .header("content-type", "application/json")
                                            .body(Full::new(Bytes::from(payload)))
                                            .unwrap()
                                    }
                                    Ok(Err(e)) => Response::builder()
                                        .status(StatusCode::SERVICE_UNAVAILABLE)
                                        .body(Full::new(Bytes::from(format!(
                                            "Failed to fetch credentials: {e}"
                                        ))))
                                        .unwrap(),
                                    Err(_) => Response::builder()
                                        .status(StatusCode::GATEWAY_TIMEOUT)
                                        .body(Full::new(Bytes::from(
                                            "Credential fetch timed out (15s)",
                                        )))
                                        .unwrap(),
                                }
                            }
                            _ => Response::builder()
                                .status(StatusCode::SERVICE_UNAVAILABLE)
                                .body(Full::new(Bytes::from("Context not found or not logged in")))
                                .unwrap(),
                        }
                    } else {
                        Response::builder()
                            .status(StatusCode::SERVICE_UNAVAILABLE)
                            .body(Full::new(Bytes::from(
                                "No active context. Run: gsa use <pattern>",
                            )))
                            .unwrap()
                    };

                    Ok(response)
                }
            });

            let conn = http1::Builder::new().serve_connection(io, service);
            let timeout = tokio::time::timeout(std::time::Duration::from_secs(30), conn);
            match timeout.await {
                Ok(Err(e)) => {
                    tracing::debug!("Connection error on credential endpoint: {e}");
                }
                Err(_) => {
                    tracing::warn!("Credential endpoint request timed out after 30s");
                }
                Ok(Ok(())) => {}
            }
        });
    }
}

/// Send a desktop notification when a session has expired.
/// Spawns on the blocking thread pool to avoid blocking the async runtime —
/// notify_rust interacts with the macOS notification framework which can block.
fn notify_session_expired(provider_display_name: &str) {
    let msg =
        format!("{provider_display_name} session has expired. Run `gsa login` to re-authenticate.");
    tokio::task::spawn_blocking(move || {
        if let Err(e) = notify_rust::Notification::new()
            .summary("gs-assume: Session Expired")
            .body(&msg)
            .icon("dialog-warning")
            .timeout(notify_rust::Timeout::Milliseconds(10_000))
            .show()
        {
            tracing::debug!("Failed to send desktop notification: {e}");
        }
    });
}

/// Ensure the daemon is running and healthy. If not, restart it.
/// Called automatically by CLI commands that need the daemon.
pub fn ensure_daemon_running() {
    if is_daemon_running() && is_daemon_healthy() {
        return;
    }

    // Daemon is down or unhealthy — full restart
    stop_daemon();
    start_daemon_background();
}

/// Check if the daemon is actually responding on its port.
fn is_daemon_healthy() -> bool {
    let port = 9911u16; // DEFAULT_PORT
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
}

/// Restart the daemon. Kills the running instance (if any) and starts fresh.
/// Used after login so the new daemon picks up freshly stored tokens from the vault.
pub fn restart_daemon() {
    stop_daemon();
    start_daemon_background();
}

/// What a command needs from the daemon/auth system before it can run.
/// Every cli command module must export `pub const REQUIREMENT: DaemonRequirement`.
/// The exhaustive match in main.rs ensures new commands are classified at compile time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonRequirement {
    /// No credentials or daemon needed (status, config, upgrade, etc.)
    None,
    /// Needs the credential daemon running (agent, mcp, use, etc.)
    /// Pre-dispatch will call ensure_daemon_running().
    Daemon,
}

/// Result of a credential endpoint check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointStatus {
    /// Credentials served successfully (HTTP 200).
    Ok,
    /// Daemon is not reachable — connection refused, timeout, or no HTTP response.
    Unreachable,
    /// Endpoint responded but cannot serve credentials (e.g. expired session, HTTP 503/401/etc).
    /// Restarting the daemon won't help — the user needs to re-authenticate.
    NeedsLogin,
}

/// Classify an HTTP status code string (from curl `-w %{http_code}`) into an EndpointStatus.
pub fn classify_http_status(code: &str) -> EndpointStatus {
    match code.trim() {
        "200" => EndpointStatus::Ok,
        // curl writes "000" when it can't connect at all (connection refused, timeout, etc.)
        "000" | "" => EndpointStatus::Unreachable,
        // Any other HTTP status means the daemon is alive but can't serve credentials
        _ => EndpointStatus::NeedsLogin,
    }
}

/// Validate the credential endpoint is serving credentials for a given context.
/// Returns an `EndpointStatus` so the caller can decide how to recover:
///   - `Ok` → credentials are flowing, nothing to do
///   - `Unreachable` → daemon is down, was restarted (and may still be unreachable)
///   - `NeedsLogin` → daemon is alive but session is expired, caller should launch login
pub fn validate_credential_endpoint(
    port: u16,
    context_id: &str,
    session_token: &str,
) -> EndpointStatus {
    let url = format!("http://localhost:{port}/credentials/{context_id}");
    let auth = format!("Bearer {session_token}");

    let status = try_credential_fetch(&url, &auth);

    match status {
        EndpointStatus::Ok => EndpointStatus::Ok,
        EndpointStatus::NeedsLogin => {
            // Daemon is alive but can't serve credentials — restarting won't help
            EndpointStatus::NeedsLogin
        }
        EndpointStatus::Unreachable => {
            // Daemon is down — restart and retry
            eprintln!("Credential endpoint not responding, restarting daemon...");
            restart_daemon();
            std::thread::sleep(std::time::Duration::from_secs(3));

            let retry = try_credential_fetch(&url, &auth);
            if retry == EndpointStatus::Unreachable {
                eprintln!("Warning: credential endpoint still not responding after daemon restart");
            }
            retry
        }
    }
}

fn try_credential_fetch(url: &str, auth: &str) -> EndpointStatus {
    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "--max-time",
            "10",
            "-H",
            &format!("Authorization: {auth}"),
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            url,
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();

    match output {
        Ok(o) => {
            let code = String::from_utf8_lossy(&o.stdout);
            classify_http_status(&code)
        }
        Err(_) => EndpointStatus::Unreachable,
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    // ── serve_action_for_current_state tests (a1) ────────────────────
    // Note: These tests use serial_test or similar isolation because
    // they modify the GS_ASSUME_CONFIG_DIR environment variable.

    #[test]
    fn serve_action_exits_ok_when_daemon_already_healthy() {
        // Test: No PID file → StartFresh
        let temp_dir = tempfile::TempDir::new().unwrap();
        let _guard = env_var_guard("GS_ASSUME_CONFIG_DIR", temp_dir.path().to_str().unwrap());
        let action = serve_action_for_current_state();
        assert_eq!(action, ServeAction::StartFresh);
    }

    #[test]
    fn serve_action_remove_stale_pid_when_file_invalid() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let _guard = env_var_guard("GS_ASSUME_CONFIG_DIR", temp_dir.path().to_str().unwrap());

        // Write an invalid PID (nonexistent process)
        let pid_file = temp_dir.path().join("daemon.pid");
        std::fs::write(&pid_file, "999999\n").unwrap();

        let action = serve_action_for_current_state();
        assert_eq!(action, ServeAction::RemoveStalePidAndStart);
    }

    #[test]
    fn serve_action_remove_stale_pid_when_pid_is_init() {
        // PID 1 is init/launchd — guaranteed to exist and NOT be gs-assume
        let temp_dir = tempfile::TempDir::new().unwrap();
        let _guard = env_var_guard("GS_ASSUME_CONFIG_DIR", temp_dir.path().to_str().unwrap());

        let pid_file = temp_dir.path().join("daemon.pid");
        std::fs::write(&pid_file, "1\n").unwrap();

        let action = serve_action_for_current_state();
        assert_eq!(action, ServeAction::RemoveStalePidAndStart);
    }

    // ── is_daemon_running tests (a2) ─────────────────────────────────

    #[test]
    fn is_daemon_running_false_when_pid_file_missing() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let _guard = env_var_guard("GS_ASSUME_CONFIG_DIR", temp_dir.path().to_str().unwrap());

        assert!(!is_daemon_running());
    }

    #[test]
    fn is_daemon_running_false_when_pid_nonexistent() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let _guard = env_var_guard("GS_ASSUME_CONFIG_DIR", temp_dir.path().to_str().unwrap());

        // Write a PID that is extremely unlikely to exist
        let pid_file = temp_dir.path().join("daemon.pid");
        std::fs::write(&pid_file, "999999\n").unwrap();

        assert!(!is_daemon_running());
    }

    #[test]
    fn is_daemon_running_rejects_pid_owned_by_other_process() {
        // PID 1 is init/launchd — guaranteed to exist and NOT be gs-assume
        let temp_dir = tempfile::TempDir::new().unwrap();
        let _guard = env_var_guard("GS_ASSUME_CONFIG_DIR", temp_dir.path().to_str().unwrap());

        let pid_file = temp_dir.path().join("daemon.pid");
        std::fs::write(&pid_file, "1\n").unwrap();

        // Should return false because PID 1 is not gs-assume
        assert!(!is_daemon_running());
    }

    /// Serializes env-var mutation across parallel tests.
    /// `std::env::{set_var, remove_var}` are process-global and not thread-safe
    /// under Rust's testing concurrency model, so any test that mutates env
    /// state must acquire this lock for the duration of its run.
    static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Helper to temporarily set an environment variable and restore it on drop.
    /// This provides test isolation without needing external crates.
    ///
    /// Holds `ENV_MUTEX` for the guard's lifetime to serialize against other
    /// env-touching tests. `MutexGuard` must be stored alongside the old value
    /// so the lock is released when the guard drops.
    struct EnvVarGuard {
        key: String,
        old_value: Option<String>,
        // Held for the lifetime of the guard; dropped alongside env restore.
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl EnvVarGuard {
        fn new(key: &str, value: &str) -> Self {
            // Recover from a poisoned lock (prior test panicked); the guard
            // semantics are still correct because we set_var immediately below.
            let lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
            let old_value = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self {
                key: key.to_string(),
                old_value,
                _lock: lock,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.old_value {
                Some(v) => std::env::set_var(&self.key, v),
                None => std::env::remove_var(&self.key),
            }
            // _lock drops here, releasing the mutex for the next test.
        }
    }

    fn env_var_guard(key: &str, value: &str) -> EnvVarGuard {
        EnvVarGuard::new(key, value)
    }

    // ── truncate_oversized_log tests (a4) ────────────────────────────

    #[test]
    fn truncate_oversized_log_truncates_large_file() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let log_path = temp_dir.path().join("daemon.stderr.log");

        // Create a 20 MB file
        let content = vec![b'x'; 20 * 1024 * 1024];
        std::fs::write(&log_path, &content).unwrap();

        assert_eq!(
            std::fs::metadata(&log_path).unwrap().len(),
            20 * 1024 * 1024
        );

        // Truncate at 10 MB threshold
        truncate_oversized_log(&log_path, 10 * 1024 * 1024).unwrap();

        // File should now be empty
        assert_eq!(std::fs::metadata(&log_path).unwrap().len(), 0);
    }

    #[test]
    fn truncate_oversized_log_leaves_small_file_alone() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let log_path = temp_dir.path().join("daemon.stderr.log");

        // Create a 1 MB file
        let content = vec![b'x'; 1024 * 1024];
        std::fs::write(&log_path, &content).unwrap();

        // Truncate at 10 MB threshold
        truncate_oversized_log(&log_path, 10 * 1024 * 1024).unwrap();

        // File should still be 1 MB
        assert_eq!(std::fs::metadata(&log_path).unwrap().len(), 1024 * 1024);
    }

    #[test]
    fn truncate_oversized_log_noop_when_missing() {
        let temp_dir = tempfile::TempDir::new().unwrap();
        let log_path = temp_dir.path().join("nonexistent.log");

        // Should not panic and return Ok
        assert!(truncate_oversized_log(&log_path, 10 * 1024 * 1024).is_ok());
    }

    // ── generate_launchd_plist tests (a3) ──────────────────────────────

    #[test]
    fn generated_launchd_plist_includes_default_rust_log() {
        let plist = generate_launchd_plist("/usr/local/bin/gs-assume");

        // Check for RUST_LOG environment variable
        assert!(
            plist.contains("<key>RUST_LOG</key>"),
            "Plist should contain RUST_LOG key"
        );
        assert!(
            plist.contains("info,hyper=warn"),
            "Plist should contain default RUST_LOG value"
        );
    }

    #[test]
    fn generated_launchd_plist_includes_throttle_interval() {
        let plist = generate_launchd_plist("/usr/local/bin/gs-assume");

        // Check for ThrottleInterval key
        assert!(
            plist.contains("<key>ThrottleInterval</key>"),
            "Plist should contain ThrottleInterval key"
        );
        assert!(
            plist.contains("<integer>10</integer>"),
            "Plist should contain ThrottleInterval value of 10"
        );
    }

    // ── classify_http_status unit tests ──────────────────────────────

    #[test]
    fn classify_200_is_ok() {
        assert_eq!(classify_http_status("200"), EndpointStatus::Ok);
    }

    #[test]
    fn classify_000_is_unreachable() {
        // curl writes "000" when it can't connect at all
        assert_eq!(classify_http_status("000"), EndpointStatus::Unreachable);
    }

    #[test]
    fn classify_empty_is_unreachable() {
        assert_eq!(classify_http_status(""), EndpointStatus::Unreachable);
    }

    #[test]
    fn classify_503_is_needs_login() {
        // This is the exact bug scenario: daemon is alive, returns 503
        // because session token is expired. Must NOT be treated as unreachable.
        assert_eq!(classify_http_status("503"), EndpointStatus::NeedsLogin);
    }

    #[test]
    fn classify_401_is_needs_login() {
        assert_eq!(classify_http_status("401"), EndpointStatus::NeedsLogin);
    }

    #[test]
    fn classify_504_is_needs_login() {
        assert_eq!(classify_http_status("504"), EndpointStatus::NeedsLogin);
    }

    #[test]
    fn classify_404_is_needs_login() {
        assert_eq!(classify_http_status("404"), EndpointStatus::NeedsLogin);
    }

    #[test]
    fn classify_handles_whitespace() {
        assert_eq!(classify_http_status("  200\n"), EndpointStatus::Ok);
        assert_eq!(classify_http_status(" 503 "), EndpointStatus::NeedsLogin);
    }

    // ── Integration tests with real HTTP server ─────────────────────
    // These verify that try_credential_fetch correctly interprets real
    // HTTP responses end-to-end (no mocks).

    /// Spin up a one-shot HTTP server that returns the given status code,
    /// call try_credential_fetch against it, and return the result.
    fn fetch_against_server(status_code: u16) -> EndpointStatus {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let url = format!("http://127.0.0.1:{port}/credentials/test-ctx");
        let auth = "Bearer test-token";

        // Spawn a thread to accept one connection and return the status
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let body = format!("{{\"status\":{status_code}}}");
            let response = format!(
                "HTTP/1.1 {status_code} X\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
        });

        let result = try_credential_fetch(&url, auth);
        handle.join().unwrap();
        result
    }

    #[test]
    fn fetch_200_server_returns_ok() {
        assert_eq!(fetch_against_server(200), EndpointStatus::Ok);
    }

    #[test]
    fn fetch_503_server_returns_needs_login() {
        // THE BUG SCENARIO: daemon responds with 503 (expired session).
        // Old code returned `false` (same as unreachable), triggering a
        // pointless daemon restart. New code must return NeedsLogin.
        assert_eq!(fetch_against_server(503), EndpointStatus::NeedsLogin);
    }

    #[test]
    fn fetch_401_server_returns_needs_login() {
        assert_eq!(fetch_against_server(401), EndpointStatus::NeedsLogin);
    }

    #[test]
    fn fetch_connection_refused_returns_unreachable() {
        // Connect to a port with nothing listening
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener); // close it immediately so connection is refused

        let url = format!("http://127.0.0.1:{port}/credentials/test-ctx");
        let result = try_credential_fetch(&url, "Bearer test-token");
        assert_eq!(result, EndpointStatus::Unreachable);
    }
}

/// Stop ALL running daemon processes, not just the PID file process.
/// This handles orphaned daemons left behind by crashes or binary updates.
fn stop_daemon() {
    // Kill the PID file process
    if let Ok(pid_str) = std::fs::read_to_string(config::pid_path()) {
        if let Ok(pid) = pid_str.trim().parse::<i32>() {
            unsafe {
                nix::libc::kill(pid, nix::libc::SIGTERM);
            }
        }
    }

    // Also kill any orphaned gs-assume serve processes
    if let Ok(output) = std::process::Command::new("pgrep")
        .args(["-f", "gs-assume serve"])
        .output()
    {
        if let Ok(pids) = String::from_utf8(output.stdout) {
            let my_pid = std::process::id() as i32;
            for line in pids.lines() {
                if let Ok(pid) = line.trim().parse::<i32>() {
                    if pid != my_pid {
                        unsafe {
                            nix::libc::kill(pid, nix::libc::SIGTERM);
                        }
                    }
                }
            }
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(500));
    remove_pid_file();
    remove_socket_file();
}

/// Fork a daemon process in the background.
fn start_daemon_background() {
    let bin = match std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
    {
        Some(p) => p,
        None => {
            tracing::debug!("Cannot resolve binary path for daemon auto-start");
            return;
        }
    };

    tracing::debug!("Starting daemon in background");
    match std::process::Command::new(&bin)
        .arg("serve")
        .arg("--foreground")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(_child) => {
            // Note: Uses blocking sleep intentionally. This runs at the end of CLI commands
            // that are about to exit, so blocking the executor briefly is acceptable.
            std::thread::sleep(std::time::Duration::from_millis(300));
            tracing::debug!("Daemon started");
        }
        Err(e) => {
            tracing::warn!("Failed to start daemon: {e}");
        }
    }
}

/// Install directory for the binary
fn install_dir() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local/bin")
}

/// launchd plist path on macOS
#[cfg(target_os = "macos")]
fn launchd_plist_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Library/LaunchAgents/com.glorious.gs-assume.plist")
}

/// Full install: copy binary to ~/.local/bin, create gsa symlink,
/// ensure PATH, install launchd agent. Returns a summary of what was done.
pub fn install() -> Result<Vec<String>> {
    let mut actions = Vec::new();

    // Stop any running daemon so we can replace the binary
    if is_daemon_running() {
        stop_daemon();
        actions.push("Stopped existing daemon".to_string());
    }

    // 1. Resolve current binary
    let src = std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .with_context(|| "Cannot resolve binary path")?;

    // 2. Copy to ~/.local/bin/gs-assume (skip if already there — self-copy truncates the file)
    let dest_dir = install_dir();
    std::fs::create_dir_all(&dest_dir)
        .with_context(|| format!("Failed to create {}", dest_dir.display()))?;

    let dest = dest_dir.join("gs-assume");
    let already_installed = dest.canonicalize().ok().map(|d| d == src).unwrap_or(false);

    if already_installed {
        actions.push(format!("Binary already at {}", dest.display()));
    } else {
        std::fs::copy(&src, &dest)
            .with_context(|| format!("Failed to copy binary to {}", dest.display()))?;

        // Make executable and clear quarantine xattrs (macOS kills binaries with provenance flags)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("xattr")
                .args(["-cr"])
                .arg(&dest)
                .status();
        }
        actions.push(format!("Installed binary to {}", dest.display()));
    }

    // 3. Create gsa symlink
    let symlink = dest_dir.join("gsa");
    let _ = std::fs::remove_file(&symlink); // remove stale symlink
    #[cfg(unix)]
    std::os::unix::fs::symlink(&dest, &symlink)
        .with_context(|| format!("Failed to create symlink {}", symlink.display()))?;
    actions.push(format!("Created symlink {}", symlink.display()));

    // 4. Ensure ~/.local/bin is in PATH via shell rc
    let dest_dir_str = dest_dir.to_string_lossy().to_string();
    if let Ok(path) = std::env::var("PATH") {
        if !path.split(':').any(|p| p == dest_dir_str) {
            // Add to shell rc files
            let home = dirs::home_dir().unwrap_or_default();
            let line = format!("\nexport PATH=\"{}:$PATH\"\n", dest_dir_str);
            for rc in [".zshrc", ".bashrc", ".bash_profile"] {
                let rc_path = home.join(rc);
                if rc_path.exists() {
                    let content = std::fs::read_to_string(&rc_path).unwrap_or_default();
                    if !content.contains(&dest_dir_str) {
                        std::fs::OpenOptions::new()
                            .append(true)
                            .open(&rc_path)
                            .and_then(|mut f| {
                                use std::io::Write;
                                f.write_all(line.as_bytes())
                            })
                            .ok();
                        actions.push(format!("Added {} to PATH in ~/{rc}", dest_dir_str));
                    }
                }
            }
        }
    }

    // 5. Add shell integration (eval + prompt) to rc files
    {
        let home = dirs::home_dir().unwrap_or_default();
        // Map shell rc to the shell type for shell-init
        let rc_shells: &[(&str, &str)] = &[
            (".zshrc", "zsh"),
            (".bashrc", "bash"),
            (".bash_profile", "bash"),
        ];
        for (rc, _shell) in rc_shells {
            let rc_path = home.join(rc);
            if rc_path.exists() {
                let content = std::fs::read_to_string(&rc_path).unwrap_or_default();
                if !content.contains("gs-assume shell-init")
                    && !content.contains("_gs_assume_prompt")
                {
                    let shell_eval = format!(
                        "\neval \"$({} shell-init {_shell})\"\n",
                        dest.to_string_lossy()
                    );
                    std::fs::OpenOptions::new()
                        .append(true)
                        .open(&rc_path)
                        .and_then(|mut f| {
                            use std::io::Write;
                            f.write_all(shell_eval.as_bytes())
                        })
                        .ok();
                    actions.push(format!("Added shell integration to ~/{rc}"));
                }
            }
        }
    }

    // 6. Install launchd agent (macOS)
    #[cfg(target_os = "macos")]
    {
        let plist_path = launchd_plist_path();
        let plist_dir = plist_path.parent().unwrap();
        std::fs::create_dir_all(plist_dir)?;

        // Detect pre-monorepo install: if an existing plist points at a
        // different binary path, log the migration so the user sees it.
        if plist_path.exists() {
            if let Ok(existing_plist) = std::fs::read_to_string(&plist_path) {
                let new_binary_path = dest.to_string_lossy();
                if !existing_plist.contains(new_binary_path.as_ref()) {
                    actions.push(format!(
                        "Migrating: existing plist pointed at a different binary — replacing with {}",
                        new_binary_path
                    ));
                }
            }
        }

        let plist = generate_launchd_plist(&dest.to_string_lossy());
        std::fs::write(&plist_path, &plist)
            .with_context(|| format!("Failed to write plist to {}", plist_path.display()))?;

        // Unload any existing version first (ignore errors)
        let _ = std::process::Command::new("launchctl")
            .args([
                "bootout",
                &format!("gui/{}", unsafe { nix::libc::getuid() }),
            ])
            .arg(&plist_path)
            .stderr(std::process::Stdio::null())
            .status();

        // Load with modern bootstrap API
        let status = std::process::Command::new("launchctl")
            .args([
                "bootstrap",
                &format!("gui/{}", unsafe { nix::libc::getuid() }),
            ])
            .arg(&plist_path)
            .status();

        match status {
            Ok(s) if s.success() => {
                actions.push(format!("Installed launch agent: {}", plist_path.display()));
            }
            _ => {
                actions.push(format!(
                    "Wrote plist to {} (will load on next login)",
                    plist_path.display()
                ));
            }
        }
    }

    // Start the new daemon so the user has a running daemon with the updated binary
    ensure_daemon_running();
    actions.push("Started daemon with new binary".to_string());

    Ok(actions)
}

/// Uninstall: remove binary, symlink, and launchd agent.
pub fn uninstall() -> Result<Vec<String>> {
    let mut actions = Vec::new();

    // Unload and remove launchd plist
    #[cfg(target_os = "macos")]
    {
        let plist_path = launchd_plist_path();
        if plist_path.exists() {
            let _ = std::process::Command::new("launchctl")
                .args([
                    "bootout",
                    &format!("gui/{}", unsafe { nix::libc::getuid() }),
                ])
                .arg(&plist_path)
                .stderr(std::process::Stdio::null())
                .status();
            std::fs::remove_file(&plist_path)?;
            actions.push("Removed launch agent".to_string());
        }
    }

    // Remove binary and symlink
    let dest_dir = install_dir();
    for name in ["gs-assume", "gsa"] {
        let path = dest_dir.join(name);
        if path.exists() {
            std::fs::remove_file(&path)?;
            actions.push(format!("Removed {}", path.display()));
        }
    }

    // Stop running daemon
    if is_daemon_running() {
        stop_daemon();
        actions.push("Stopped daemon".to_string());
    }

    Ok(actions)
}

/// Generate a launchd plist for auto-starting the daemon on macOS
pub fn generate_launchd_plist(binary_path: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.glorious.gs-assume</string>
    <key>ProgramArguments</key>
    <array>
        <string>{binary_path}</string>
        <string>serve</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>RUST_LOG</key>
        <string>info,hyper=warn</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{log_dir}/daemon.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/daemon.stderr.log</string>
</dict>
</plist>"#,
        binary_path = binary_path,
        log_dir = config::config_dir().display()
    )
}
