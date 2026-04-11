use crate::core::daemon::DaemonRequirement;
use crate::core::{audit, config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;
use std::process::Command;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

#[derive(Args, Debug)]
pub struct ExecArgs {
    /// Context pattern (e.g., "prod/admin", "gcp:my-project"). Omit to use active context.
    #[arg(long = "profile", short = 'p')]
    pub profile: Option<String>,

    /// Provider to search in (e.g., "aws", "gcp"). Narrows context matching.
    #[arg(long)]
    pub provider: Option<String>,

    /// Command and arguments to run
    #[arg(trailing_var_arg = true, required = true)]
    pub command: Vec<String>,
}

pub async fn run(args: ExecArgs, registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    if args.command.is_empty() {
        bail!("No command specified. Usage: gsa exec [-p <pattern>] -- <command>");
    }

    // Resolve context: use --profile if given, otherwise fall back to active context
    let context = if let Some(ref profile) = args.profile {
        // Support "gcp:novelist-app" syntax — split into provider + pattern
        let (provider_filter, pattern) = if let Some((prov, pat)) = profile.split_once(':') {
            (Some(prov.to_string()), pat.to_string())
        } else {
            (args.provider.clone(), profile.clone())
        };

        // Collect contexts — prefer cache, fall back to live API
        let mut all_contexts = Vec::new();
        let providers: Vec<String> = match provider_filter {
            Some(ref p) => vec![p.clone()],
            None => registry.ids(),
        };
        for provider_id in &providers {
            if let Some(cached) = crate::core::cache::load_contexts(provider_id) {
                all_contexts.extend(cached);
            } else {
                let tokens = match keychain::load_tokens(provider_id)? {
                    Some(t) => t,
                    None => continue,
                };
                let provider = match registry.get(provider_id) {
                    Some(p) => p,
                    None => continue,
                };
                if let Ok(contexts) = provider.list_contexts(&tokens).await {
                    all_contexts.extend(contexts);
                }
            }
        }
        let matches = fuzzy::match_contexts(&pattern, &all_contexts);
        match matches.first() {
            Some(m) => m.context.clone(),
            None => bail!("No context matching '{profile}'"),
        }
    } else if let Some(ref provider_id) = args.provider {
        // --provider without --profile: use the active context if it matches the provider
        let active = crate::core::cache::load_active_context().ok_or_else(|| {
            anyhow::anyhow!("No active context. Run: gsa use {provider_id} <profile>")
        })?;
        if active.provider_id != *provider_id {
            bail!("Active context is for '{}', not '{provider_id}'. Run: gsa use {provider_id} <profile>", active.provider_id);
        }
        active
    } else {
        // Use the active context
        crate::core::cache::load_active_context().ok_or_else(|| {
            anyhow::anyhow!("No active context. Run: gsa use <provider> <profile>")
        })?
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
    } else if context.provider_id == "gcp" {
        // Access token for gcloud CLI
        if let Some(access_token) = tokens.secrets.get("access_token") {
            env_vars.push(("CLOUDSDK_AUTH_ACCESS_TOKEN".into(), access_token.clone()));
        }
        // Project env vars
        let project_id = context
            .metadata
            .get("project_id")
            .unwrap_or(&context.id)
            .clone();
        env_vars.push(("GOOGLE_CLOUD_PROJECT".into(), project_id.clone()));
        env_vars.push(("CLOUDSDK_CORE_PROJECT".into(), project_id));
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
