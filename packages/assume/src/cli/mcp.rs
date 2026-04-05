use crate::core::{audit, cache, config};
use anyhow::Result;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

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
            "tools/call" => handle_tools_call(&params),
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
    writeln!(stdout, "{}", serde_json::to_string(&response).unwrap_or_default())?;
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
                "description": "Run a shell command with AWS credentials injected from gsa. Only works for contexts approved via `gsa agent allow`. Returns stdout, stderr, and exit code.",
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
                        }
                    },
                    "required": ["command"]
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

fn handle_tools_call(params: &Value) -> Result<Value, (i32, String)> {
    let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    match tool_name {
        "run_with_credentials" => tool_run_with_credentials(&arguments),
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

fn tool_run_with_credentials(arguments: &Value) -> Result<Value, (i32, String)> {
    let command = arguments.get("command")
        .and_then(|c| c.as_str())
        .ok_or((-32602, "Missing required parameter: command".to_string()))?;

    let context_pattern = arguments.get("context").and_then(|c| c.as_str());

    // 1. Resolve context
    let context = if let Some(pattern) = context_pattern {
        let mut all_contexts = Vec::new();
        for provider_id in ["aws"] {
            if let Some(contexts) = cache::load_contexts(provider_id) {
                all_contexts.extend(contexts);
            }
        }
        let matches = crate::core::fuzzy::match_contexts(pattern, &all_contexts);
        matches.into_iter().next()
            .map(|m| m.context)
            .ok_or((-32602, format!("No context matching '{pattern}'")))?
    } else {
        cache::load_active_context()
            .ok_or((-32602, "No active context. Run: gsa use <pattern>".to_string()))?
    };

    // 2. Permission check
    let allowed = cache::load_agent_allowed();
    if !allowed.contains(&context.id) {
        return Err((-32602, format!(
            "Context '{}' is not approved for agent access. The user needs to run: gsa agent allow",
            context.display_name
        )));
    }

    // 3. Fetch credentials from daemon
    let cfg = config::load_config().map_err(|e| (-32603, format!("Config error: {e}")))?;
    let port = cfg.providers.get("aws").and_then(|p| p.port)
        .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);

    let cred_json = fetch_credentials_from_daemon(&context.id, port)
        .ok_or((-32603, "Failed to fetch credentials from daemon. Is it running? User should run: gsa login aws".to_string()))?;

    let env_vars = parse_ecs_credentials(&cred_json)
        .ok_or((-32603, "Failed to parse credential response".to_string()))?;

    // 4. Build full env
    let mut env: Vec<(String, String)> = env_vars;
    if !context.region.is_empty() {
        env.push(("AWS_REGION".into(), context.region.clone()));
        env.push(("AWS_DEFAULT_REGION".into(), context.region.clone()));
    }

    // 5. Execute command
    let output = std::process::Command::new("sh")
        .args(["-c", command])
        .envs(env)
        .output()
        .map_err(|e| (-32603, format!("Failed to execute command: {e}")))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    // 6. Audit log
    audit::log_event(
        audit::AuditEvent::CredentialFetch,
        &context.provider_id,
        &format!("mcp run_with_credentials: {command}"),
    );

    // Build response text
    let mut text = String::new();
    if !stdout_str.is_empty() {
        text.push_str(&stdout_str);
    }
    if !stderr_str.is_empty() {
        if !text.is_empty() { text.push('\n'); }
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

/// Fetch credentials from the daemon's HTTP endpoint via curl.
fn fetch_credentials_from_daemon(context_id: &str, port: u16) -> Option<String> {
    let token = crate::providers::aws::endpoint::get_or_create_session_token();
    let url = format!("http://localhost:{port}/credentials/{context_id}");

    let output = std::process::Command::new("curl")
        .args([
            "-fsSL",
            "--max-time", "5",
            "-H", &format!("Authorization: Bearer {token}"),
        ])
        .arg(&url)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout).ok()
}

/// Parse AWS ECS credential JSON into env var pairs.
fn parse_ecs_credentials(json: &str) -> Option<Vec<(String, String)>> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let access_key = v.get("AccessKeyId")?.as_str()?;
    let secret_key = v.get("SecretAccessKey")?.as_str()?;
    let session_token = v.get("Token")?.as_str()?;

    Some(vec![
        ("AWS_ACCESS_KEY_ID".into(), access_key.to_string()),
        ("AWS_SECRET_ACCESS_KEY".into(), secret_key.to_string()),
        ("AWS_SESSION_TOKEN".into(), session_token.to_string()),
    ])
}
