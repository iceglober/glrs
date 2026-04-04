use crate::core::config::{self, Config};
use crate::core::keychain;
use crate::plugin::registry::PluginRegistry;
use crate::plugin::{AuthTokens, Context, Credentials, ProviderError};
use anyhow::{Context as _, Result};
use chrono::Utc;
use std::collections::HashMap;
use std::net::SocketAddr;
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
                        crate::plugin::EndpointAuth::BearerToken { token } => req
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .map(|v| v.strip_prefix("Bearer ").unwrap_or("") == token.as_str())
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

/// Ensure the daemon is running. If not, fork a background process.
/// Called automatically by CLI commands that need the daemon.
pub fn ensure_daemon_running() {
    if is_daemon_running() {
        return;
    }

    let bin = match std::env::current_exe().ok().and_then(|p| p.canonicalize().ok()) {
        Some(p) => p,
        None => {
            tracing::debug!("Cannot resolve binary path for daemon auto-start");
            return;
        }
    };

    tracing::debug!("Auto-starting daemon in background");
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
            tracing::debug!("Daemon auto-started");
        }
        Err(e) => {
            tracing::warn!("Failed to auto-start daemon: {e}");
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
fn launchd_plist_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Library/LaunchAgents/com.glorious.gs-assume.plist")
}

/// Full install: copy binary to ~/.local/bin, create gsa symlink,
/// ensure PATH, install launchd agent. Returns a summary of what was done.
pub fn install() -> Result<Vec<String>> {
    let mut actions = Vec::new();

    // 1. Resolve current binary
    let src = std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .with_context(|| "Cannot resolve binary path")?;

    // 2. Copy to ~/.local/bin/gs-assume
    let dest_dir = install_dir();
    std::fs::create_dir_all(&dest_dir)
        .with_context(|| format!("Failed to create {}", dest_dir.display()))?;

    let dest = dest_dir.join("gs-assume");
    std::fs::copy(&src, &dest)
        .with_context(|| format!("Failed to copy binary to {}", dest.display()))?;

    // Make executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }
    actions.push(format!("Installed binary to {}", dest.display()));

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
                if !content.contains("gs-assume shell-init") && !content.contains("_gs_assume_prompt") {
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

        let plist = generate_launchd_plist(&dest.to_string_lossy());
        std::fs::write(&plist_path, &plist)
            .with_context(|| format!("Failed to write plist to {}", plist_path.display()))?;

        // Unload any existing version first (ignore errors)
        let _ = std::process::Command::new("launchctl")
            .args(["bootout", &format!("gui/{}", unsafe { nix::libc::getuid() })])
            .arg(&plist_path)
            .stderr(std::process::Stdio::null())
            .status();

        // Load with modern bootstrap API
        let status = std::process::Command::new("launchctl")
            .args(["bootstrap", &format!("gui/{}", unsafe { nix::libc::getuid() })])
            .arg(&plist_path)
            .status();

        match status {
            Ok(s) if s.success() => {
                actions.push(format!("Installed launch agent: {}", plist_path.display()));
            }
            _ => {
                actions.push(format!("Wrote plist to {} (will load on next login)", plist_path.display()));
            }
        }
    }

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
                .args(["bootout", &format!("gui/{}", unsafe { nix::libc::getuid() })])
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
        // Kill the running daemon process
        if let Ok(pid_str) = std::fs::read_to_string(config::pid_path()) {
            if let Ok(pid) = pid_str.trim().parse::<i32>() {
                unsafe { nix::libc::kill(pid, nix::libc::SIGTERM); }
                // Brief wait for graceful shutdown
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
        remove_pid_file();
        remove_socket_file();
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
