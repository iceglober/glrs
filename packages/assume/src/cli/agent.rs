use crate::core::{audit, cache, config, keychain};
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
    /// Context pattern (e.g., "prod/admin", "my-project", "gcp:my-project")
    #[arg(long = "profile", short = 'p')]
    pub profile: Option<String>,

    /// Provider to search in (e.g., "aws", "gcp"). Narrows context matching.
    #[arg(long)]
    pub provider: Option<String>,

    /// Command and arguments to run
    #[arg(trailing_var_arg = true, required = true)]
    pub command: Vec<String>,
}

pub async fn run(args: AgentArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    match args.command {
        AgentCommands::Allow(allow_args) => run_allow(allow_args, registry).await,
        AgentCommands::Exec(exec_args) => run_exec(exec_args, registry, cfg).await,
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
                let danger = if ctx.tags.contains(&"dangerous".to_string()) {
                    " \u{26a0}"
                } else {
                    ""
                };
                eprintln!("  {} ({}){}", ctx.display_name, ctx.region, danger);
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

async fn run_exec(
    args: AgentExecArgs,
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<()> {
    if args.command.is_empty() {
        bail!("No command specified. Usage: gsa agent exec -- <command>");
    }

    // 1. Resolve context — supports "gcp:project" syntax
    let context = if let Some(ref profile) = args.profile {
        let (provider_filter, pattern) = if let Some((prov, pat)) = profile.split_once(':') {
            (Some(prov.to_string()), pat.to_string())
        } else {
            (args.provider.clone(), profile.clone())
        };

        let mut all_contexts = Vec::new();
        let providers: Vec<String> = match provider_filter {
            Some(ref p) => vec![p.clone()],
            None => registry.ids(),
        };
        for provider_id in &providers {
            if let Some(contexts) = cache::load_contexts(provider_id) {
                all_contexts.extend(contexts);
            }
        }
        let matches = crate::core::fuzzy::match_contexts(&pattern, &all_contexts);
        match matches.first() {
            Some(m) => m.context.clone(),
            None => bail!("No context matching '{profile}'"),
        }
    } else if let Some(ref provider_id) = args.provider {
        let active = cache::load_active_context().ok_or_else(|| {
            anyhow::anyhow!("No active context. Run: gsa use {provider_id} <profile>")
        })?;
        if active.provider_id != *provider_id {
            bail!(
                "Active context is for '{}', not '{provider_id}'. Run: gsa use {provider_id} <profile>",
                active.provider_id
            );
        }
        active
    } else {
        cache::load_active_context().ok_or_else(|| {
            anyhow::anyhow!("No active context. Run: gsa use <provider> <profile>")
        })?
    };

    // 2. Permission check
    let allowed = cache::load_agent_allowed();
    if !allowed.contains(&context.id) {
        bail!(
            "Context '{}' is not approved for agent access.\nRun: gsa agent allow",
            context.display_name
        );
    }

    // 3. Build env vars based on provider
    let mut env_vars: Vec<(String, String)> = Vec::new();

    if context.provider_id == "aws" {
        // Use daemon endpoint for auto-refreshing AWS credentials
        crate::core::daemon::ensure_daemon_running();

        let port = cfg
            .providers
            .get("aws")
            .and_then(|p| p.port)
            .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);
        let token = crate::providers::aws::endpoint::get_or_create_session_token();

        env_vars.push((
            "AWS_CONTAINER_CREDENTIALS_FULL_URI".into(),
            format!("http://localhost:{port}/credentials/{}", context.id),
        ));
        env_vars.push((
            "AWS_CONTAINER_AUTHORIZATION_TOKEN".into(),
            format!("Bearer {token}"),
        ));
        if !context.region.is_empty() {
            env_vars.push(("AWS_REGION".into(), context.region.clone()));
            env_vars.push(("AWS_DEFAULT_REGION".into(), context.region.clone()));
        }
    } else if context.provider_id == "gcp" {
        // Inject access token for gcloud CLI + project env vars
        let tokens = keychain::load_tokens("gcp")?
            .ok_or_else(|| anyhow::anyhow!("Not authenticated for GCP. Run: gsa login gcp"))?;
        if let Some(access_token) = tokens.secrets.get("access_token") {
            env_vars.push(("CLOUDSDK_AUTH_ACCESS_TOKEN".into(), access_token.clone()));
        }
        let project_id = context
            .metadata
            .get("project_id")
            .unwrap_or(&context.id)
            .clone();
        env_vars.push(("GOOGLE_CLOUD_PROJECT".into(), project_id.clone()));
        env_vars.push(("CLOUDSDK_CORE_PROJECT".into(), project_id));
    }

    // Common env vars
    env_vars.push((
        "GS_ASSUME_CONTEXT".into(),
        format!("{}:{}", context.provider_id, context.display_name),
    ));
    env_vars.push(("GS_ASSUME_CONTEXT_ID".into(), context.id.clone()));
    env_vars.push((
        "GS_ASSUME_CONTEXT_PROVIDER".into(),
        context.provider_id.clone(),
    ));

    // 4. Run the command
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
