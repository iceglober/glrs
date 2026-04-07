use crate::core::{audit, config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;
use std::process::Command;

#[derive(Args, Debug)]
pub struct ExecArgs {
    /// Context pattern (e.g., "aws:prod/admin"). Defaults to the active context.
    #[arg(long = "profile")]
    pub profile: Option<String>,

    /// Command and arguments to run
    #[arg(trailing_var_arg = true, required = true)]
    pub command: Vec<String>,
}

pub async fn run(args: ExecArgs, registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    if args.command.is_empty() {
        bail!("No command specified. Usage: gs-assume exec [--profile <pattern>] -- <command>");
    }

    // Resolve context: use --profile if given, otherwise fall back to active context
    let context = if let Some(ref profile) = args.profile {
        // Collect all contexts and fuzzy match
        let mut all_contexts = Vec::new();
        for provider_id in registry.ids() {
            let provider = registry.get(&provider_id).unwrap();
            let tokens = match keychain::load_tokens(&provider_id)? {
                Some(t) => t,
                None => continue,
            };
            if let Ok(contexts) = provider.list_contexts(&tokens).await {
                all_contexts.extend(contexts);
            }
        }
        let matches = fuzzy::match_contexts(profile, &all_contexts);
        match matches.first() {
            Some(m) => m.context.clone(),
            None => bail!("No context matching '{profile}'"),
        }
    } else {
        // Use the active context
        crate::core::cache::load_active_context()
            .ok_or_else(|| anyhow::anyhow!("No active context. Run: gs-assume use <context>"))?
    };
    let context = &context;

    // Get credentials
    let provider = registry
        .get(&context.provider_id)
        .ok_or_else(|| anyhow::anyhow!("Provider not found: {}", context.provider_id))?;

    let tokens = keychain::load_tokens(&context.provider_id)?
        .ok_or_else(|| anyhow::anyhow!("Not authenticated for {}", context.provider_id))?;

    let credentials = provider
        .get_credentials(&tokens, context)
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "Failed to get credentials for {}: {e}",
                context.display_name
            )
        })?;

    // Build env vars based on provider
    let mut env_vars: Vec<(String, String)> = Vec::new();

    // Env vars to remove from the child process (prevent conflicts)
    let mut remove_vars: Vec<&str> = Vec::new();

    if context.provider_id == "aws" {
        let sts = crate::providers::aws::credentials::extract_sts_credentials(&credentials)?;
        env_vars.push(("AWS_ACCESS_KEY_ID".into(), sts.access_key_id));
        env_vars.push(("AWS_SECRET_ACCESS_KEY".into(), sts.secret_access_key));
        env_vars.push(("AWS_SESSION_TOKEN".into(), sts.session_token));
        env_vars.push(("AWS_DEFAULT_REGION".into(), context.region.clone()));
        env_vars.push(("AWS_REGION".into(), context.region.clone()));
        // Clear container credential vars so the AWS SDK uses the static creds above
        // instead of trying to reach the credential proxy
        remove_vars.extend(&[
            "AWS_CONTAINER_CREDENTIALS_FULL_URI",
            "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
            "AWS_CONTAINER_AUTHORIZATION_TOKEN",
        ]);
    }

    // Run the command
    let program = &args.command[0];
    let cmd_args = &args.command[1..];

    let mut cmd = Command::new(program);
    cmd.args(cmd_args).envs(env_vars);
    for var in &remove_vars {
        cmd.env_remove(var);
    }
    let status = cmd.status()?;

    audit::log_event(
        audit::AuditEvent::CredentialFetch,
        &context.provider_id,
        &format!("exec {} as {}", program, context.id),
    );

    std::process::exit(status.code().unwrap_or(1));
}
