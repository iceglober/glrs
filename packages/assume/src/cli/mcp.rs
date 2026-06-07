use crate::core::daemon::DaemonRequirement;
use crate::core::{audit, cache, config};
use anyhow::Result;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::Daemon;

const SERVER_NAME: &str = "gsa";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const PROTOCOL_VERSION: &str = "2024-11-05";

/// Run the MCP server, reading JSON-RPC from stdin and writing to stdout.
pub async fn run() -> Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                write_error(&mut stdout, Value::Null, -32700, "Parse error")?;
                continue;
            }
        };

        let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let id = request.get("id").cloned();
        let params = request.get("params").cloned().unwrap_or(json!({}));

        // Notifications (no id) — acknowledge silently
        if id.is_none() {
            continue;
        }

        let id = id.unwrap();

        let result = match method {
            "initialize" => handle_initialize(&params),
            "tools/list" => handle_tools_list(),
            "tools/call" => handle_tools_call(&params).await,
            _ => Err((-32601, format!("Method not found: {method}"))),
        };

        match result {
            Ok(value) => {
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": value,
                });
                writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
                stdout.flush()?;
            }
            Err((code, message)) => {
                write_error(&mut stdout, id, code, &message)?;
            }
        }
    }

    Ok(())
}

fn write_error(stdout: &mut impl Write, id: Value, code: i32, message: &str) -> io::Result<()> {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message,
        },
    });
    writeln!(
        stdout,
        "{}",
        serde_json::to_string(&response).unwrap_or_default()
    )?;
    stdout.flush()
}

fn handle_initialize(_params: &Value) -> Result<Value, (i32, String)> {
    Ok(json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION,
        }
    }))
}

fn handle_tools_list() -> Result<Value, (i32, String)> {
    Ok(json!({
        "tools": [
            {
                "name": "run_with_credentials",
                "description": "Run a shell command with AWS credentials injected from gsa, in the gsa MCP server's working directory (the workspace root it was launched in — same as the bash tool). Optionally pass repo-specific environment variables via `env`. Only works for contexts approved via `gsa agent allow`. Returns stdout, stderr, and exit code.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Shell command to execute (passed to sh -c)"
                        },
                        "context": {
                            "type": "string",
                            "description": "Context pattern to use (optional, defaults to active context from gsa use)"
                        },
                        "env": {
                            "type": "object",
                            "additionalProperties": { "type": "string" },
                            "description": "Additional environment variables (string values) set for the command, alongside the injected AWS credentials. The gsa-injected AWS_* credential and region vars take precedence and cannot be overridden."
                        },
                        "timeout_ms": {
                            "type": "integer",
                            "description": "Max milliseconds to wait for the command before killing it and returning a clear timeout (default 120000, max 600000). A hung command no longer blocks until the MCP client gives up; on timeout, session health is checked and stale-session guidance is returned."
                        }
                    },
                    "required": ["command"]
                }
            },
            {
                "name": "check_session",
                "description": "Check whether the gsa AWS session is valid before running commands. Returns { valid, needs_login, session_expires_at, refresh_expires_at }. When invalid, `action` tells the user the exact `gsa login` command to run (an interactive browser flow an agent cannot perform). Use this at session start, or after a command fails, to distinguish a stale session from a genuine command error.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "list_contexts",
                "description": "List AWS contexts that are approved for agent access via gsa agent allow",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    }))
}

async fn handle_tools_call(params: &Value) -> Result<Value, (i32, String)> {
    let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    match tool_name {
        "run_with_credentials" => tool_run_with_credentials(&arguments).await,
        "check_session" => tool_check_session(&arguments),
        "list_contexts" => tool_list_contexts(),
        _ => Err((-32602, format!("Unknown tool: {tool_name}"))),
    }
}

fn tool_list_contexts() -> Result<Value, (i32, String)> {
    let allowed = cache::load_agent_allowed();
    if allowed.is_empty() {
        return Ok(json!({
            "content": [{
                "type": "text",
                "text": "No contexts approved for agent access. The user needs to run: gsa agent allow"
            }]
        }));
    }

    // Load all cached contexts and filter to allowed
    let mut results = Vec::new();
    for provider_id in ["aws"] {
        if let Some(contexts) = cache::load_contexts(provider_id) {
            for ctx in contexts {
                if allowed.contains(&ctx.id) {
                    results.push(json!({
                        "id": ctx.id,
                        "display_name": ctx.display_name,
                        "region": ctx.region,
                        "provider": ctx.provider_id,
                    }));
                }
            }
        }
    }

    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&results).unwrap_or_default()
        }]
    }))
}

/// Parse the optional `env` argument into ordered (name, value) pairs.
///
/// Values must be strings (env vars are inherently strings — coercing numbers
/// silently would surprise callers). Names must be non-empty and free of `=`
/// and NUL, which the OS forbids. Returns a JSON-RPC invalid-params error
/// (-32602) on malformed input so the caller gets a clear message rather than a
/// silently-dropped variable. Absent or null `env` yields an empty vec.
fn parse_env_arg(arguments: &Value) -> Result<Vec<(String, String)>, (i32, String)> {
    let env_val = match arguments.get("env") {
        None => return Ok(Vec::new()),
        Some(v) if v.is_null() => return Ok(Vec::new()),
        Some(v) => v,
    };
    let obj = env_val.as_object().ok_or((
        -32602,
        "Parameter `env` must be an object of string values".to_string(),
    ))?;
    let mut out = Vec::with_capacity(obj.len());
    for (name, val) in obj {
        if name.is_empty() || name.contains('=') || name.contains('\0') {
            return Err((-32602, format!("Invalid env var name: {name:?}")));
        }
        let value = val
            .as_str()
            .ok_or((-32602, format!("env var {name:?} must be a string value")))?;
        if value.contains('\0') {
            return Err((
                -32602,
                format!("env var {name:?} value contains a NUL byte"),
            ));
        }
        out.push((name.clone(), value.to_string()));
    }
    Ok(out)
}

/// Default/clamp bounds for the per-command execution timeout.
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

/// Parse `timeout_ms` (or legacy `timeout`), accepting either a JSON number or a
/// numeric string (agents have passed both), clamped to sane bounds.
fn parse_timeout_ms(arguments: &Value) -> u64 {
    let raw = arguments
        .get("timeout_ms")
        .or_else(|| arguments.get("timeout"));
    let parsed = match raw {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.trim().parse::<u64>().ok(),
        _ => None,
    };
    parsed
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

/// Resolved view of a provider's auth state, used by both `check_session` and
/// the stale-session guard in `run_with_credentials`.
struct SessionHealth {
    /// Usable now or auto-refreshable by the daemon (refresh window still open).
    valid: bool,
    /// The daemon flagged a rejected refresh — only a browser re-login fixes it.
    needs_login: bool,
    session_expires_at: Option<String>,
    refresh_expires_at: Option<String>,
    /// Human-readable reason when not valid.
    reason: Option<String>,
}

/// Determine whether `provider_id`'s session can still produce credentials.
///
/// Mirrors the dead-session logic in `main.rs`: dead when the daemon set the
/// needs-login marker (rejected refresh / SSO ended), tokens are missing, or the
/// refresh window has lapsed. An expired *access* token alone is fine — the
/// daemon auto-refreshes it — so only `refresh_expires_at` is fatal.
fn session_health(provider_id: &str) -> SessionHealth {
    let now = chrono::Utc::now();
    if crate::core::cache::needs_login(provider_id) {
        return SessionHealth {
            valid: false,
            needs_login: true,
            session_expires_at: None,
            refresh_expires_at: None,
            reason: Some("the daemon flagged a rejected refresh (the SSO session ended)".into()),
        };
    }
    match crate::core::keychain::load_tokens(provider_id) {
        Ok(Some(t)) => {
            let refresh_dead = t.refresh_expires_at <= now;
            SessionHealth {
                valid: !refresh_dead,
                needs_login: false,
                session_expires_at: Some(t.session_expires_at.to_rfc3339()),
                refresh_expires_at: Some(t.refresh_expires_at.to_rfc3339()),
                reason: refresh_dead.then(|| "the refresh token has expired".to_string()),
            }
        }
        _ => SessionHealth {
            valid: false,
            needs_login: false,
            session_expires_at: None,
            refresh_expires_at: None,
            reason: Some("no stored credentials".into()),
        },
    }
}

/// Structured result returned when the session is too stale to run a command.
/// Carries machine-readable `session_stale`/`action` fields plus prose so the
/// agent stops retrying and surfaces the re-login to the user.
fn stale_session_result(provider_id: &str, context_display: &str, health: &SessionHealth) -> Value {
    let reason = health
        .reason
        .clone()
        .unwrap_or_else(|| "the session is not valid".to_string());
    json!({
        "content": [{
            "type": "text",
            "text": format!(
                "gsa session for '{context_display}' is stale — {reason}. \
                 Re-authenticating requires a human to complete an SSO browser sign-in; an agent cannot do that step. \
                 In an interactive local session you MAY launch `gsa login {provider_id}` in the background (it opens a browser for the user to finish), then poll the `check_session` tool until it reports valid before retrying. \
                 Otherwise (headless/remote, or no browser available) ask the user to run:  gsa login {provider_id}\n\
                 A desktop notification has been sent. Do not retry this command until `check_session` reports the session is valid."
            )
        }],
        "isError": true,
        "session_stale": true,
        "action": format!("gsa login {provider_id}"),
        "needs_login": health.needs_login,
        "session_expires_at": health.session_expires_at,
        "refresh_expires_at": health.refresh_expires_at,
    })
}

/// `check_session` tool — report AWS session validity without running anything.
fn tool_check_session(_arguments: &Value) -> Result<Value, (i32, String)> {
    let provider_id = "aws";
    let health = session_health(provider_id);

    // Best-effort: name the default context for the summary line.
    let mut defaults = cache::load_all_defaults();
    let context_name = if defaults.len() == 1 {
        defaults.remove(0).display_name
    } else {
        provider_id.to_string()
    };

    let summary = if health.valid {
        match &health.session_expires_at {
            Some(exp) => format!(
                "gsa session for '{context_name}' is valid (access token expires {exp}; auto-refreshed by the daemon)."
            ),
            None => format!("gsa session for '{context_name}' is valid."),
        }
    } else {
        let reason = health
            .reason
            .clone()
            .unwrap_or_else(|| "session not valid".to_string());
        format!(
            "gsa session for '{context_name}' is NOT valid — {reason}. Ask the user to run: gsa login {provider_id}"
        )
    };

    Ok(json!({
        "content": [{ "type": "text", "text": summary }],
        "valid": health.valid,
        "needs_login": health.needs_login,
        "provider": provider_id,
        "context": context_name,
        "session_expires_at": health.session_expires_at,
        "refresh_expires_at": health.refresh_expires_at,
        "action": if health.valid { Value::Null } else { json!(format!("gsa login {provider_id}")) },
    }))
}

async fn tool_run_with_credentials(arguments: &Value) -> Result<Value, (i32, String)> {
    let command = arguments
        .get("command")
        .and_then(|c| c.as_str())
        .ok_or((-32602, "Missing required parameter: command".to_string()))?;

    let context_pattern = arguments.get("context").and_then(|c| c.as_str());

    // Caller-supplied env vars (validated up front so a bad arg fails fast,
    // before we resolve contexts or touch the daemon).
    let user_env = parse_env_arg(arguments)?;

    // 1. Resolve context
    let context = if let Some(pattern) = context_pattern {
        let mut all_contexts = Vec::new();
        for provider_id in ["aws"] {
            if let Some(contexts) = cache::load_contexts(provider_id) {
                all_contexts.extend(contexts);
            }
        }
        let matches = crate::core::fuzzy::match_contexts(pattern, &all_contexts);
        matches
            .into_iter()
            .next()
            .map(|m| m.context)
            .ok_or((-32602, format!("No context matching '{pattern}'")))?
    } else {
        let mut defaults = cache::load_all_defaults();
        match defaults.len() {
            1 => defaults.remove(0),
            0 => {
                return Err((
                    -32602,
                    "No default context. Run: gsa use <provider> <context> --default".to_string(),
                ))
            }
            _ => {
                return Err((
                    -32602,
                    "Multiple default contexts set. Pass a context explicitly.".to_string(),
                ))
            }
        }
    };

    // 2. Permission check
    let allowed = cache::load_agent_allowed();
    if !allowed.contains(&context.id) {
        return Err((
            -32602,
            format!(
            "Context '{}' is not approved for agent access. The user needs to run: gsa agent allow",
            context.display_name
        ),
        ));
    }

    // Daemon is already ensured by centralized pre-dispatch in main.rs.

    // 2b. Stale-session guard. If the session can't produce credentials, the
    // injected endpoint will 503 or hang — which historically surfaced as an
    // opaque MCP `-32001 Request timed out` after the client gave up. Fail fast
    // with actionable guidance and an OS notification instead.
    let health = session_health(&context.provider_id);
    if !health.valid {
        crate::core::notify::notify_session_expired(&context.provider_id);
        return Ok(stale_session_result(
            &context.provider_id,
            &context.display_name,
            &health,
        ));
    }

    let timeout_ms = parse_timeout_ms(arguments);

    // 3. Build env vars — point at daemon endpoint for auto-refreshing credentials
    let cfg = config::load_config().map_err(|e| (-32603, format!("Config error: {e}")))?;
    let port = cfg
        .providers
        .get("aws")
        .and_then(|p| p.port)
        .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);
    let token = crate::providers::aws::endpoint::get_or_create_session_token();

    // Caller-supplied env first; the gsa-injected AWS_* vars are pushed AFTER so
    // they win on any key collision (`Command::envs` lets later entries
    // override). This is deliberate: a caller must not be able to redirect the
    // credential endpoint/token via `env`. Record the names (not values — values
    // may be secrets) for the audit log before `user_env` is moved into `env`.
    let mut env_note = String::new();
    if !user_env.is_empty() {
        let mut names: Vec<&str> = user_env.iter().map(|(n, _)| n.as_str()).collect();
        names.sort_unstable();
        env_note = format!(" [env: {}]", names.join(", "));
    }

    let mut env: Vec<(String, String)> = user_env;
    env.push((
        "AWS_CONTAINER_CREDENTIALS_FULL_URI".into(),
        format!("http://localhost:{port}/credentials/{}", context.id),
    ));
    env.push((
        "AWS_CONTAINER_AUTHORIZATION_TOKEN".into(),
        format!("Bearer {token}"),
    ));

    if !context.region.is_empty() {
        env.push(("AWS_REGION".into(), context.region.clone()));
        env.push(("AWS_DEFAULT_REGION".into(), context.region.clone()));
    }

    // 5. Execute command, bounded by `timeout_ms`. `kill_on_drop` reaps the
    // child if we time out (the future is dropped), so a hung command can't
    // linger. On timeout we re-check session health: a stale session is the
    // usual cause, and we surface re-login guidance rather than a bare timeout.
    let mut cmd = tokio::process::Command::new("sh");
    cmd.args(["-c", command]).envs(env).kill_on_drop(true);

    let output = match tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        cmd.output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err((-32603, format!("Failed to execute command: {e}"))),
        Err(_elapsed) => {
            let health = session_health(&context.provider_id);
            if !health.valid {
                crate::core::notify::notify_session_expired(&context.provider_id);
                return Ok(stale_session_result(
                    &context.provider_id,
                    &context.display_name,
                    &health,
                ));
            }
            return Ok(json!({
                "content": [{
                    "type": "text",
                    "text": format!(
                        "Command timed out after {timeout_ms} ms and was killed. The gsa session still looks valid, so this is likely the command itself (a slow query, a missing `&` on a long task, or a network stall) — not credentials. Re-run with a larger `timeout_ms`, or launch long work in the background with `&`."
                    )
                }],
                "isError": true,
                "timed_out": true,
            }));
        }
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    // 5b. If the command failed, check whether the session went stale during the
    // run (the daemon may have just flagged a rejected refresh). If so, surface
    // re-login guidance instead of letting the agent puzzle over the raw error.
    if exit_code != 0 {
        let health = session_health(&context.provider_id);
        if !health.valid {
            crate::core::notify::notify_session_expired(&context.provider_id);
            return Ok(stale_session_result(
                &context.provider_id,
                &context.display_name,
                &health,
            ));
        }
    }

    // 6. Audit log
    audit::log_event(
        audit::AuditEvent::CredentialFetch,
        &context.provider_id,
        &format!("mcp run_with_credentials: {command}{env_note}"),
    );

    let mut text = String::new();
    if !stdout_str.is_empty() {
        text.push_str(&stdout_str);
    }
    if !stderr_str.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str("stderr:\n");
        text.push_str(&stderr_str);
    }
    if text.is_empty() {
        text = format!("Command completed with exit code {exit_code}");
    }

    Ok(json!({
        "content": [{
            "type": "text",
            "text": text
        }],
        "isError": exit_code != 0
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn env_absent_or_null_is_empty() {
        assert!(parse_env_arg(&json!({})).unwrap().is_empty());
        assert!(parse_env_arg(&json!({ "env": null })).unwrap().is_empty());
    }

    #[test]
    fn env_parses_string_values_in_order_independent_pairs() {
        let args = json!({ "env": { "A": "1", "TEMPORAL_NAMESPACE": "kn-prod" } });
        let out = parse_env_arg(&args).unwrap();
        assert_eq!(out.len(), 2);
        // Order within a JSON object isn't guaranteed across serde versions, so
        // assert by membership rather than index.
        assert!(out.contains(&("A".to_string(), "1".to_string())));
        assert!(out.contains(&("TEMPORAL_NAMESPACE".to_string(), "kn-prod".to_string())));
    }

    #[test]
    fn env_rejects_non_object() {
        assert!(parse_env_arg(&json!({ "env": "A=1" })).is_err());
        assert!(parse_env_arg(&json!({ "env": ["A", "1"] })).is_err());
    }

    #[test]
    fn env_rejects_non_string_value() {
        // Numbers/bools are not coerced — callers must pass strings explicitly.
        assert!(parse_env_arg(&json!({ "env": { "PORT": 7233 } })).is_err());
        assert!(parse_env_arg(&json!({ "env": { "FLAG": true } })).is_err());
    }

    #[test]
    fn env_rejects_invalid_names() {
        assert!(parse_env_arg(&json!({ "env": { "": "x" } })).is_err());
        assert!(parse_env_arg(&json!({ "env": { "A=B": "x" } })).is_err());
    }

    #[test]
    fn timeout_defaults_when_absent() {
        assert_eq!(parse_timeout_ms(&json!({})), DEFAULT_TIMEOUT_MS);
    }

    #[test]
    fn timeout_accepts_number_and_numeric_string() {
        assert_eq!(parse_timeout_ms(&json!({ "timeout_ms": 30000 })), 30000);
        // Agents have passed the legacy `timeout` key as a string.
        assert_eq!(parse_timeout_ms(&json!({ "timeout": "15000" })), 15000);
    }

    #[test]
    fn timeout_is_clamped() {
        assert_eq!(
            parse_timeout_ms(&json!({ "timeout_ms": 1 })),
            MIN_TIMEOUT_MS
        );
        assert_eq!(
            parse_timeout_ms(&json!({ "timeout_ms": 9_999_999 })),
            MAX_TIMEOUT_MS
        );
    }

    #[test]
    fn stale_result_is_machine_readable() {
        let health = SessionHealth {
            valid: false,
            needs_login: true,
            session_expires_at: None,
            refresh_expires_at: None,
            reason: Some("the SSO session ended".into()),
        };
        let v = stale_session_result("aws", "production / developer", &health);
        assert_eq!(v["session_stale"], json!(true));
        assert_eq!(v["isError"], json!(true));
        assert_eq!(v["action"], json!("gsa login aws"));
        assert_eq!(v["needs_login"], json!(true));
        let text = v["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("gsa login aws"));
        assert!(text.contains("production / developer"));
        // Softened guidance: agent may self-launch in interactive sessions, and
        // should gate retries on check_session rather than a fixed wait.
        assert!(text.contains("background"));
        assert!(text.contains("check_session"));
    }
}
