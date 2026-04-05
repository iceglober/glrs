use crate::core::{audit, cache, config};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::{Args, Subcommand};

#[derive(Args, Debug)]
pub struct AgentArgs {
    #[command(subcommand)]
    pub command: AgentCommands,
}

#[derive(Subcommand, Debug)]
pub enum AgentCommands {
    /// Toggle which contexts agents can access
    Allow(AllowArgs),
    /// Run a command with injected credentials (agent-gated)
    Exec(AgentExecArgs),
    /// Start MCP server for AI agent integration
    Mcp,
}

#[derive(Args, Debug)]
pub struct AllowArgs {
    /// Clear all agent access
    #[arg(long)]
    pub clear: bool,
    /// List currently allowed contexts (non-interactive)
    #[arg(long)]
    pub list: bool,
}

#[derive(Args, Debug)]
pub struct AgentExecArgs {
    /// Context pattern (optional, defaults to active context)
    #[arg(long = "profile", short = 'p')]
    pub profile: Option<String>,

    /// Command and arguments to run
    #[arg(trailing_var_arg = true, required = true)]
    pub command: Vec<String>,
}

pub async fn run(args: AgentArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    match args.command {
        AgentCommands::Allow(allow_args) => run_allow(allow_args, registry).await,
        AgentCommands::Exec(exec_args) => run_exec(exec_args, cfg).await,
        AgentCommands::Mcp => crate::cli::mcp::run().await,
    }
}

async fn run_allow(args: AllowArgs, registry: &PluginRegistry) -> Result<()> {
    if args.clear {
        cache::clear_agent_allowed();
        eprintln!("Cleared all agent access permissions");
        return Ok(());
    }

    // Load all cached contexts across providers
    let mut all_contexts = Vec::new();
    for provider_id in registry.ids() {
        if let Some(contexts) = cache::load_contexts(&provider_id) {
            all_contexts.extend(contexts);
        }
    }

    if all_contexts.is_empty() {
        bail!("No cached contexts. Run: gsa sync");
    }

    let current_allowed = cache::load_agent_allowed();

    if args.list {
        if current_allowed.is_empty() {
            eprintln!("No contexts are approved for agent access.");
            eprintln!("Run: gsa agent allow");
            return Ok(());
        }
        eprintln!("Contexts approved for agent access:");
        for ctx in &all_contexts {
            if current_allowed.contains(&ctx.id) {
                let danger = if ctx.tags.contains(&"dangerous".to_string()) { " \u{26a0}" } else { "" };
                eprintln!("  {} ({}){}",  ctx.display_name, ctx.region, danger);
            }
        }
        return Ok(());
    }

    // Open TUI multi-select
    match crate::tui::picker::run_multi_select(&all_contexts, &current_allowed)? {
        crate::tui::picker::MultiSelectResult::Saved(selected) => {
            let count = selected.len();
            cache::save_agent_allowed(&selected)?;
            eprintln!("Saved: {} context(s) approved for agent access", count);
        }
        crate::tui::picker::MultiSelectResult::Cancelled => {
            eprintln!("Cancelled");
        }
    }

    Ok(())
}

/// Fetch credentials from the daemon's HTTP endpoint via curl.
/// Returns the raw JSON payload on success.
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

async fn run_exec(args: AgentExecArgs, cfg: &config::Config) -> Result<()> {
    if args.command.is_empty() {
        bail!("No command specified. Usage: gsa agent exec -- <command>");
    }

    // 1. Resolve context
    let context = if let Some(ref pattern) = args.profile {
        // Fuzzy match against cached contexts
        let mut all_contexts = Vec::new();
        for provider_id in ["aws"] {
            if let Some(contexts) = cache::load_contexts(provider_id) {
                all_contexts.extend(contexts);
            }
        }
        let matches = crate::core::fuzzy::match_contexts(pattern, &all_contexts);
        match matches.into_iter().next() {
            Some(m) => m.context,
            None => bail!("No context matching '{pattern}'"),
        }
    } else {
        // Default to active context
        cache::load_active_context()
            .ok_or_else(|| anyhow::anyhow!("No active context. Run: gsa use <pattern>"))?
    };

    // 2. Permission check
    let allowed = cache::load_agent_allowed();
    if !allowed.contains(&context.id) {
        bail!(
            "Context '{}' is not approved for agent access.\nRun: gsa agent allow",
            context.display_name
        );
    }

    // 3. Fetch credentials from daemon
    let port = cfg
        .providers
        .get("aws")
        .and_then(|p| p.port)
        .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);

    let cred_json = fetch_credentials_from_daemon(&context.id, port)
        .ok_or_else(|| anyhow::anyhow!(
            "Failed to fetch credentials from daemon. Is it running? Try: gsa login aws"
        ))?;

    let mut env_vars = parse_ecs_credentials(&cred_json)
        .ok_or_else(|| anyhow::anyhow!("Failed to parse credential response from daemon"))?;

    // 4. Add region
    if !context.region.is_empty() {
        env_vars.push(("AWS_REGION".into(), context.region.clone()));
        env_vars.push(("AWS_DEFAULT_REGION".into(), context.region.clone()));
    }

    // Add context metadata for prompt/tooling
    env_vars.push(("GS_ASSUME_CONTEXT".into(), format!("{}:{}", context.provider_id, context.display_name)));
    env_vars.push(("GS_ASSUME_CONTEXT_ID".into(), context.id.clone()));
    env_vars.push(("GS_ASSUME_CONTEXT_PROVIDER".into(), context.provider_id.clone()));

    // 5. Run the command
    let program = &args.command[0];
    let cmd_args = &args.command[1..];

    let status = std::process::Command::new(program)
        .args(cmd_args)
        .envs(env_vars)
        .status()?;

    audit::log_event(
        audit::AuditEvent::CredentialFetch,
        &context.provider_id,
        &format!("agent exec {} as {}", program, context.id),
    );

    std::process::exit(status.code().unwrap_or(1));
}
