use crate::core::config::{self, Config};
use crate::core::keychain;
use crate::plugin::registry::PluginRegistry;
use crate::plugin::{AuthTokens, Context, Credentials, ProviderError};
use anyhow::{bail, Context as _, Result};
use chrono::Utc;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UnixListener;
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
            plugin_states.insert(id, state);
        }
        Self {
            config,
            registry,
            plugin_states,
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
                signal::kill(Pid::from_raw(pid), None).is_ok()
            } else {
                false
            }
        }
        Err(_) => false,
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
    let buffer = chrono::Duration::from_std(schedule.refresh_buffer)
        .unwrap_or(chrono::Duration::minutes(5));

    // 1. Check if active context's credentials need refresh
    if let Some(ref active_ctx) = plugin_state.active_context {
        let needs_cred_refresh = plugin_state
            .credential_cache
            .get(&active_ctx.id)
            .map(|cred| cred.expires_at - buffer < now)
            .unwrap_or(true);

        if needs_cred_refresh {
            match provider.get_credentials(&tokens, active_ctx).await {
                Ok(creds) => {
                    let mut s = state.write().await;
                    if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                        ps.credential_cache.insert(active_ctx.id.clone(), creds);
                    }
                    tracing::debug!("Refreshed credentials for {provider_id}:{}", active_ctx.id);
                }
                Err(ProviderError::AccessTokenExpired) => {
                    tracing::info!("Access token expired for {provider_id}, refreshing session");
                    // Fall through to session refresh below
                }
                Err(ProviderError::RefreshTokenExpired) => {
                    tracing::warn!("Refresh token expired for {provider_id}");
                    let mut s = state.write().await;
                    if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                        ps.status = PluginStatus::NeedsLogin;
                    }
                    notify_session_expired(provider.display_name());
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
        tracing::info!("Refreshing session token for {provider_id}");
        match provider.refresh(&tokens).await {
            Ok(new_tokens) => {
                keychain::store_tokens(provider_id, &new_tokens)?;
                let mut s = state.write().await;
                if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                    ps.tokens = Some(new_tokens);
                }
                tracing::info!("Session refreshed for {provider_id}");
            }
            Err(ProviderError::RefreshTokenExpired) => {
                tracing::warn!("Refresh token expired for {provider_id}");
                let mut s = state.write().await;
                if let Some(ps) = s.plugin_states.get_mut(provider_id) {
                    ps.status = PluginStatus::NeedsLogin;
                }
                notify_session_expired(provider.display_name());
            }
            Err(ProviderError::NetworkError(msg)) => {
                tracing::warn!("Network error during session refresh for {provider_id}: {msg}");
                // Retry next tick -- credentials may still be valid
            }
            Err(e) => {
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
                    // Check path
                    if req.uri().path() != expected_path {
                        return Ok::<_, hyper::Error>(
                            Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Full::new(Bytes::from("Not Found")))
                                .unwrap(),
                        );
                    }

                    // Check auth
                    let authed = match &auth {
                        crate::plugin::EndpointAuth::BearerToken { token } => {
                            req.headers()
                                .get("authorization")
                                .and_then(|v| v.to_str().ok())
                                .map(|v| v.strip_prefix("Bearer ").unwrap_or("") == token.as_str())
                                .unwrap_or(false)
                        }
                        crate::plugin::EndpointAuth::RequiredHeader { key, value } => {
                            req.headers()
                                .get(key.as_str())
                                .and_then(|v| v.to_str().ok())
                                .map(|v| v == value.as_str())
                                .unwrap_or(false)
                        }
                    };

                    if !authed {
                        return Ok(Response::builder()
                            .status(StatusCode::UNAUTHORIZED)
                            .body(Full::new(Bytes::from("Unauthorized")))
                            .unwrap());
                    }

                    // Serve credentials
                    let s = state.read().await;
                    let response = if let Some(ps) = s.plugin_states.get(&provider_id) {
                        if let Some(ref ctx) = ps.active_context {
                            if let Some(creds) = ps.credential_cache.get(&ctx.id) {
                                Response::builder()
                                    .status(StatusCode::OK)
                                    .header("content-type", "application/json")
                                    .body(Full::new(Bytes::from(creds.payload.clone())))
                                    .unwrap()
                            } else {
                                Response::builder()
                                    .status(StatusCode::SERVICE_UNAVAILABLE)
                                    .body(Full::new(Bytes::from("Credentials not yet available")))
                                    .unwrap()
                            }
                        } else {
                            Response::builder()
                                .status(StatusCode::SERVICE_UNAVAILABLE)
                                .body(Full::new(Bytes::from("No active context")))
                                .unwrap()
                        }
                    } else {
                        Response::builder()
                            .status(StatusCode::SERVICE_UNAVAILABLE)
                            .body(Full::new(Bytes::from("Provider not found")))
                            .unwrap()
                    };

                    Ok(response)
                }
            });

            if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                tracing::debug!("Connection error on credential endpoint: {e}");
            }
        });
    }
}

/// Start the Unix socket RPC listener for CLI-to-daemon communication.
/// Handles commands like status, switch context, list contexts, etc.
#[allow(dead_code)]
pub async fn start_rpc_listener(state: SharedDaemonState) -> Result<()> {
    let sock_path = config::socket_path();

    // Remove stale socket file if it exists
    if sock_path.exists() {
        std::fs::remove_file(&sock_path)?;
    }

    config::ensure_config_dir()?;
    let listener = UnixListener::bind(&sock_path)
        .with_context(|| format!("Failed to bind Unix socket: {}", sock_path.display()))?;

    // Set socket permissions to owner-only (0o600)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&sock_path, std::fs::Permissions::from_mode(0o600))?;
    }

    tracing::info!("RPC listener started on {}", sock_path.display());

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    if let Err(e) = handle_rpc_connection(stream, state).await {
                        tracing::debug!("RPC connection error: {e}");
                    }
                });
            }
            Err(e) => {
                tracing::warn!("Failed to accept RPC connection: {e}");
            }
        }
    }
}

/// Handle a single RPC connection over a Unix socket.
/// Protocol: newline-delimited JSON request/response.
#[allow(dead_code)]
async fn handle_rpc_connection(
    stream: tokio::net::UnixStream,
    state: SharedDaemonState,
) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines.next_line().await? {
        let response = match handle_rpc_request(&line, &state).await {
            Ok(resp) => resp,
            Err(e) => {
                serde_json::json!({
                    "error": e.to_string()
                })
                .to_string()
            }
        };

        writer
            .write_all(response.as_bytes())
            .await
            .context("Failed to write RPC response")?;
        writer
            .write_all(b"\n")
            .await
            .context("Failed to write RPC newline")?;
        writer.flush().await.context("Failed to flush RPC writer")?;
    }

    Ok(())
}

/// Parse and dispatch a single RPC request
#[allow(dead_code)]
async fn handle_rpc_request(request: &str, state: &SharedDaemonState) -> Result<String> {
    let req: serde_json::Value =
        serde_json::from_str(request).context("Invalid JSON in RPC request")?;

    let method = req
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match method {
        "status" => rpc_status(state).await,
        "list_contexts" => {
            let provider_id = req
                .get("provider_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            rpc_list_contexts(state, provider_id).await
        }
        "switch_context" => {
            let provider_id = req
                .get("provider_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let context_id = req
                .get("context_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            rpc_switch_context(state, provider_id, context_id).await
        }
        "refresh" => {
            let provider_id = req
                .get("provider_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            rpc_refresh(state, provider_id).await
        }
        "pin_session" => {
            let provider_id = req
                .get("provider_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let session_id = req
                .get("session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let context_id = req
                .get("context_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            rpc_pin_session(state, provider_id, session_id, context_id).await
        }
        "unpin_session" => {
            let provider_id = req
                .get("provider_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let session_id = req
                .get("session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            rpc_unpin_session(state, provider_id, session_id).await
        }
        "ping" => Ok(serde_json::json!({"ok": true}).to_string()),
        "shutdown" => {
            tracing::info!("Shutdown requested via RPC");
            // Signal the process to exit cleanly
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                std::process::exit(0);
            });
            Ok(serde_json::json!({"ok": true, "message": "shutting down"}).to_string())
        }
        _ => Ok(serde_json::json!({
            "error": format!("unknown method: {method}")
        })
        .to_string()),
    }
}

/// RPC: return status of all plugins
#[allow(dead_code)]
async fn rpc_status(state: &SharedDaemonState) -> Result<String> {
    let s = state.read().await;
    let mut providers = serde_json::Map::new();

    for (id, ps) in &s.plugin_states {
        let status_str = match &ps.status {
            PluginStatus::Active => "active",
            PluginStatus::NeedsLogin => "needs_login",
            PluginStatus::Broken(_) => "broken",
        };
        let mut entry = serde_json::Map::new();
        entry.insert("status".into(), serde_json::json!(status_str));
        if let PluginStatus::Broken(msg) = &ps.status {
            entry.insert("error".into(), serde_json::json!(msg));
        }
        if let Some(ref ctx) = ps.active_context {
            entry.insert("active_context".into(), serde_json::json!(ctx.display_name));
            entry.insert("active_context_id".into(), serde_json::json!(ctx.id));
        }
        entry.insert("context_count".into(), serde_json::json!(ps.contexts.len()));
        entry.insert(
            "cached_credentials".into(),
            serde_json::json!(ps.credential_cache.len()),
        );
        entry.insert(
            "pinned_sessions".into(),
            serde_json::json!(ps.pinned_sessions.len()),
        );
        providers.insert(id.clone(), serde_json::Value::Object(entry));
    }

    Ok(serde_json::json!({
        "ok": true,
        "providers": providers
    })
    .to_string())
}

/// RPC: list contexts for a provider
#[allow(dead_code)]
async fn rpc_list_contexts(state: &SharedDaemonState, provider_id: &str) -> Result<String> {
    if provider_id.is_empty() {
        bail!("provider_id is required");
    }

    let s = state.read().await;
    let ps = s
        .plugin_states
        .get(provider_id)
        .with_context(|| format!("Unknown provider: {provider_id}"))?;

    let contexts: Vec<serde_json::Value> = ps
        .contexts
        .iter()
        .map(|ctx| {
            serde_json::json!({
                "id": ctx.id,
                "display_name": ctx.display_name,
                "provider_id": ctx.provider_id,
                "tags": ctx.tags,
                "region": ctx.region,
                "active": ps.active_context.as_ref().map(|a| a.id == ctx.id).unwrap_or(false),
            })
        })
        .collect();

    Ok(serde_json::json!({
        "ok": true,
        "contexts": contexts
    })
    .to_string())
}

/// RPC: switch active context for a provider
#[allow(dead_code)]
async fn rpc_switch_context(
    state: &SharedDaemonState,
    provider_id: &str,
    context_id: &str,
) -> Result<String> {
    if provider_id.is_empty() || context_id.is_empty() {
        bail!("provider_id and context_id are required");
    }

    let mut s = state.write().await;
    let ps = s
        .plugin_states
        .get_mut(provider_id)
        .with_context(|| format!("Unknown provider: {provider_id}"))?;

    let target = ps
        .contexts
        .iter()
        .find(|c| c.id == context_id)
        .cloned()
        .with_context(|| format!("Context not found: {context_id}"))?;

    let display_name = target.display_name.clone();
    ps.active_context = Some(target);

    // Invalidate credential cache for the old context so the refresh loop
    // picks up credentials for the new one immediately
    tracing::info!("Switched {provider_id} to context {context_id} ({display_name})");

    Ok(serde_json::json!({
        "ok": true,
        "active_context": context_id,
        "display_name": display_name
    })
    .to_string())
}

/// RPC: force a refresh for a specific provider
#[allow(dead_code)]
async fn rpc_refresh(state: &SharedDaemonState, provider_id: &str) -> Result<String> {
    if provider_id.is_empty() {
        bail!("provider_id is required");
    }

    refresh_provider(state, provider_id).await?;

    Ok(serde_json::json!({
        "ok": true,
        "message": format!("Refresh triggered for {provider_id}")
    })
    .to_string())
}

/// RPC: pin a session to a specific context (for worktree isolation)
#[allow(dead_code)]
async fn rpc_pin_session(
    state: &SharedDaemonState,
    provider_id: &str,
    session_id: &str,
    context_id: &str,
) -> Result<String> {
    if provider_id.is_empty() || session_id.is_empty() || context_id.is_empty() {
        bail!("provider_id, session_id, and context_id are required");
    }

    let mut s = state.write().await;
    let ps = s
        .plugin_states
        .get_mut(provider_id)
        .with_context(|| format!("Unknown provider: {provider_id}"))?;

    let target = ps
        .contexts
        .iter()
        .find(|c| c.id == context_id)
        .cloned()
        .with_context(|| format!("Context not found: {context_id}"))?;

    ps.pinned_sessions
        .insert(session_id.to_string(), target);
    tracing::info!("Pinned session {session_id} to {provider_id}:{context_id}");

    Ok(serde_json::json!({
        "ok": true,
        "pinned": { "session_id": session_id, "context_id": context_id }
    })
    .to_string())
}

/// RPC: unpin a session
#[allow(dead_code)]
async fn rpc_unpin_session(
    state: &SharedDaemonState,
    provider_id: &str,
    session_id: &str,
) -> Result<String> {
    if provider_id.is_empty() || session_id.is_empty() {
        bail!("provider_id and session_id are required");
    }

    let mut s = state.write().await;
    let ps = s
        .plugin_states
        .get_mut(provider_id)
        .with_context(|| format!("Unknown provider: {provider_id}"))?;

    ps.pinned_sessions.remove(session_id);
    tracing::info!("Unpinned session {session_id} from {provider_id}");

    Ok(serde_json::json!({
        "ok": true,
        "unpinned": session_id
    })
    .to_string())
}

/// Send a desktop notification when a session has expired
fn notify_session_expired(provider_display_name: &str) {
    if let Err(e) = notify_rust::Notification::new()
        .summary("gs-assume: Session Expired")
        .body(&format!(
            "{provider_display_name} session has expired. Run `gs-assume login` to re-authenticate."
        ))
        .icon("dialog-warning")
        .timeout(notify_rust::Timeout::Milliseconds(10_000))
        .show()
    {
        tracing::debug!("Failed to send desktop notification: {e}");
    }
}

/// Generate a launchd plist for auto-starting the daemon on macOS
#[allow(dead_code)]
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
