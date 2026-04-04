use crate::core::config;
use crate::core::daemon::{PluginStatus, SharedDaemonState};
use crate::core::keychain;
use crate::plugin::Context;
use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

#[derive(Debug, Deserialize)]
struct RpcRequest {
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct RpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl RpcResponse {
    fn ok(result: Value) -> Self {
        Self {
            result: Some(result),
            error: None,
        }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self {
            result: None,
            error: Some(msg.into()),
        }
    }
}

/// Start the RPC listener on the Unix domain socket
pub async fn start_rpc_listener(state: SharedDaemonState) -> Result<()> {
    let socket_path = config::socket_path();

    // Remove stale socket if it exists
    if socket_path.exists() {
        std::fs::remove_file(&socket_path)
            .with_context(|| format!("Failed to remove stale socket: {}", socket_path.display()))?;
    }

    config::ensure_config_dir()?;
    let listener = UnixListener::bind(&socket_path)
        .with_context(|| format!("Failed to bind Unix socket: {}", socket_path.display()))?;

    // Set socket permissions to 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))
            .with_context(|| "Failed to set socket permissions")?;
    }

    tracing::info!("RPC listener started on {}", socket_path.display());

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, state).await {
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

async fn handle_connection(stream: tokio::net::UnixStream, state: SharedDaemonState) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    while reader.read_line(&mut line).await? > 0 {
        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => handle_request(&req, &state).await,
            Err(e) => RpcResponse::err(format!("Invalid request: {e}")),
        };

        let mut resp_json = serde_json::to_string(&response)?;
        resp_json.push('\n');
        writer.write_all(resp_json.as_bytes()).await?;
        writer.flush().await?;

        line.clear();
    }

    Ok(())
}

async fn handle_request(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    match req.method.as_str() {
        "ping" => RpcResponse::ok(Value::String("pong".into())),
        "status" => handle_status(state).await,
        "list_contexts" => handle_list_contexts(req, state).await,
        "switch_context" => handle_switch_context(req, state).await,
        "get_credentials" => handle_get_credentials(req, state).await,
        "refresh" => handle_refresh(req, state).await,
        "pin_session" => handle_pin_session(req, state).await,
        "unpin_session" => handle_unpin_session(req, state).await,
        "shutdown" => {
            tracing::info!("Shutdown requested via RPC");
            // Trigger graceful shutdown
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                std::process::exit(0);
            });
            RpcResponse::ok(Value::String("shutting down".into()))
        }
        _ => RpcResponse::err(format!("Unknown method: {}", req.method)),
    }
}

async fn handle_status(state: &SharedDaemonState) -> RpcResponse {
    let s = state.read().await;
    let mut providers = serde_json::Map::new();

    for (id, ps) in &s.plugin_states {
        let provider = s.registry.get(id);
        let mut info = serde_json::Map::new();

        info.insert(
            "status".into(),
            Value::String(match &ps.status {
                PluginStatus::Active => "active".into(),
                PluginStatus::NeedsLogin => "needs_login".into(),
                PluginStatus::Broken(msg) => format!("broken: {msg}"),
            }),
        );

        if let Some(ref ctx) = ps.active_context {
            info.insert(
                "active_context".into(),
                serde_json::to_value(ctx).unwrap_or_default(),
            );
        }

        if let Some(ref tokens) = ps.tokens {
            info.insert(
                "session_expires_at".into(),
                Value::String(tokens.session_expires_at.to_rfc3339()),
            );
            info.insert(
                "refresh_expires_at".into(),
                Value::String(tokens.refresh_expires_at.to_rfc3339()),
            );
        }

        if let Some(ref ctx) = ps.active_context {
            if let Some(creds) = ps.credential_cache.get(&ctx.id) {
                info.insert(
                    "credential_expires_at".into(),
                    Value::String(creds.expires_at.to_rfc3339()),
                );
            }
        }

        info.insert(
            "context_count".into(),
            Value::Number(ps.contexts.len().into()),
        );

        if let Some(p) = provider {
            info.insert(
                "display_name".into(),
                Value::String(p.display_name().to_string()),
            );
        }

        providers.insert(id.clone(), Value::Object(info));
    }

    RpcResponse::ok(Value::Object(providers))
}

async fn handle_list_contexts(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    let provider_id = req.params.get("provider").and_then(|v| v.as_str());
    let s = state.read().await;

    let mut all_contexts: Vec<&Context> = Vec::new();
    for (id, ps) in &s.plugin_states {
        if let Some(pid) = provider_id {
            if id != pid {
                continue;
            }
        }
        all_contexts.extend(ps.contexts.iter());
    }

    RpcResponse::ok(serde_json::to_value(&all_contexts).unwrap_or_default())
}

async fn handle_switch_context(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    let provider_id = match req.params.get("provider").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'provider' param"),
    };
    let context_id = match req.params.get("context_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'context_id' param"),
    };

    let mut s = state.write().await;
    let ps = match s.plugin_states.get_mut(&provider_id) {
        Some(ps) => ps,
        None => return RpcResponse::err(format!("Provider not found: {provider_id}")),
    };

    let context = match ps.contexts.iter().find(|c| c.id == context_id) {
        Some(c) => c.clone(),
        None => return RpcResponse::err(format!("Context not found: {context_id}")),
    };

    ps.active_context = Some(context.clone());
    RpcResponse::ok(serde_json::to_value(&context).unwrap_or_default())
}

async fn handle_get_credentials(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    let provider_id = match req.params.get("provider").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'provider' param"),
    };

    let s = state.read().await;
    let ps = match s.plugin_states.get(&provider_id) {
        Some(ps) => ps,
        None => return RpcResponse::err(format!("Provider not found: {provider_id}")),
    };

    let ctx = match &ps.active_context {
        Some(c) => c,
        None => return RpcResponse::err("No active context"),
    };

    match ps.credential_cache.get(&ctx.id) {
        Some(creds) => RpcResponse::ok(serde_json::to_value(creds).unwrap_or_default()),
        None => RpcResponse::err("Credentials not yet cached"),
    }
}

async fn handle_refresh(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    let provider_id = match req.params.get("provider").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'provider' param"),
    };

    // Trigger an immediate refresh for this provider
    let (provider, tokens) = {
        let s = state.read().await;
        let provider = match s.registry.get(&provider_id) {
            Some(p) => Arc::clone(p),
            None => return RpcResponse::err(format!("Provider not found: {provider_id}")),
        };
        let tokens = match s
            .plugin_states
            .get(&provider_id)
            .and_then(|ps| ps.tokens.clone())
        {
            Some(t) => t,
            None => return RpcResponse::err("No tokens available — run gs-assume login"),
        };
        (provider, tokens)
    };

    match provider.refresh(&tokens).await {
        Ok(new_tokens) => {
            if let Err(e) = keychain::store_tokens(&provider_id, &new_tokens) {
                return RpcResponse::err(format!("Failed to store refreshed tokens: {e}"));
            }
            let mut s = state.write().await;
            if let Some(ps) = s.plugin_states.get_mut(&provider_id) {
                ps.tokens = Some(new_tokens);
            }
            RpcResponse::ok(Value::String("refreshed".into()))
        }
        Err(e) => RpcResponse::err(format!("Refresh failed: {e}")),
    }
}

async fn handle_pin_session(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    let provider_id = match req.params.get("provider").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'provider' param"),
    };
    let terminal_id = match req.params.get("terminal_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'terminal_id' param"),
    };
    let context_id = match req.params.get("context_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'context_id' param"),
    };

    let mut s = state.write().await;
    let ps = match s.plugin_states.get_mut(&provider_id) {
        Some(ps) => ps,
        None => return RpcResponse::err(format!("Provider not found: {provider_id}")),
    };

    let context = match ps.contexts.iter().find(|c| c.id == context_id) {
        Some(c) => c.clone(),
        None => return RpcResponse::err(format!("Context not found: {context_id}")),
    };

    ps.pinned_sessions.insert(terminal_id, context);
    RpcResponse::ok(Value::String("pinned".into()))
}

async fn handle_unpin_session(req: &RpcRequest, state: &SharedDaemonState) -> RpcResponse {
    let provider_id = match req.params.get("provider").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'provider' param"),
    };
    let terminal_id = match req.params.get("terminal_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return RpcResponse::err("Missing 'terminal_id' param"),
    };

    let mut s = state.write().await;
    if let Some(ps) = s.plugin_states.get_mut(&provider_id) {
        ps.pinned_sessions.remove(&terminal_id);
    }
    RpcResponse::ok(Value::String("unpinned".into()))
}

/// Send a single RPC request to the daemon and return the response.
/// Used by CLI commands to communicate with a running daemon.
#[allow(dead_code)]
pub async fn rpc_call(method: &str, params: Value) -> Result<Value> {
    let socket_path = config::socket_path();

    let stream = tokio::net::UnixStream::connect(&socket_path)
        .await
        .with_context(|| {
            format!(
                "Failed to connect to daemon at {}. Is it running? Try: gs-assume serve",
                socket_path.display()
            )
        })?;

    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    let request = serde_json::json!({
        "method": method,
        "params": params,
    });
    let mut req_json = serde_json::to_string(&request)?;
    req_json.push('\n');
    writer.write_all(req_json.as_bytes()).await?;
    writer.flush().await?;

    let mut line = String::new();
    reader.read_line(&mut line).await?;

    let response: RpcResponse =
        serde_json::from_str(&line).context("Invalid response from daemon")?;

    if let Some(error) = response.error {
        anyhow::bail!("{error}");
    }

    Ok(response.result.unwrap_or(Value::Null))
}
