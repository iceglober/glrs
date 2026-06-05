use crate::core::daemon::DaemonRequirement;
use crate::core::{audit, config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;
use std::process::Command;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::BackgroundEnsure;

#[derive(Args, Debug)]
pub struct ExecArgs {
    /// Context pattern (e.g., "prod/admin", "gcp:my-project"). Omit to use active context.
    #[arg(long = "context", short = 'c', alias = "profile")]
    pub context: Option<String>,

    /// Provider to search in (e.g., "aws", "gcp"). Narrows context matching.
    #[arg(long)]
    pub provider: Option<String>,

    /// Command and arguments to run
    #[arg(trailing_var_arg = true, required = true)]
    pub command: Vec<String>,
}

pub async fn run(args: ExecArgs, registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    if args.command.is_empty() {
        bail!("No command specified. Usage: gsa exec [-c <pattern>] -- <command>");
    }

    // Resolve which context(s) to inject:
    //   -c <pattern>   → that one context (today's behavior)
    //   --provider <p> → that provider's default
    //   neither        → every provider's default, so the child gets the same
    //                    ambient credentials an interactive shell would (AWS and
    //                    GCP at once).
    let contexts: Vec<crate::plugin::Context> = if let Some(ref ctx_pattern) = args.context {
        vec![resolve_pattern(ctx_pattern, args.provider.as_deref(), registry).await?]
    } else if let Some(ref provider_id) = args.provider {
        let ctx = crate::core::cache::load_default(provider_id).ok_or_else(|| {
            anyhow::anyhow!("No default context for {provider_id}. Run: gsa use {provider_id} <context> --default")
        })?;
        vec![ctx]
    } else {
        let defaults = crate::core::cache::load_all_defaults();
        if defaults.is_empty() {
            bail!("No default context. Run: gsa use <provider> <context> --default");
        }
        defaults
    };

    // Build the merged child environment across every selected context. AWS and
    // GCP use disjoint variable names, so two providers compose cleanly.
    let mut env_vars: Vec<(String, String)> = Vec::new();
    let mut remove_vars: Vec<&str> = Vec::new();
    let mut injected: Vec<String> = Vec::new();

    for context in &contexts {
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

        if context.provider_id == "aws" {
            let sts = crate::providers::aws::credentials::extract_sts_credentials(&credentials)?;
            env_vars.push(("AWS_ACCESS_KEY_ID".into(), sts.access_key_id));
            env_vars.push(("AWS_SECRET_ACCESS_KEY".into(), sts.secret_access_key));
            env_vars.push(("AWS_SESSION_TOKEN".into(), sts.session_token));
            env_vars.push(("AWS_DEFAULT_REGION".into(), context.region.clone()));
            env_vars.push(("AWS_REGION".into(), context.region.clone()));
            // Clear container credential vars so the AWS SDK uses the static creds
            // above instead of reaching for the credential proxy.
            remove_vars.extend(&[
                "AWS_CONTAINER_CREDENTIALS_FULL_URI",
                "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
                "AWS_CONTAINER_AUTHORIZATION_TOKEN",
            ]);
        } else if context.provider_id == "gcp" {
            // The GCP credential payload is a gcloud-minted access token.
            if let Ok(p) = serde_json::from_slice::<
                crate::providers::gcp::credentials::GcpTokenPayload,
            >(&credentials.payload)
            {
                env_vars.push(("CLOUDSDK_AUTH_ACCESS_TOKEN".into(), p.access_token));
            }
            let project_id = context
                .metadata
                .get("project_id")
                .unwrap_or(&context.id)
                .clone();
            env_vars.push(("GOOGLE_CLOUD_PROJECT".into(), project_id.clone()));
            env_vars.push(("CLOUDSDK_CORE_PROJECT".into(), project_id));
        }

        injected.push(format!("{} as {}", context.provider_id, context.id));
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
        &contexts[0].provider_id,
        &format!("exec {} ({})", program, injected.join(", ")),
    );

    std::process::exit(status.code().unwrap_or(1));
}

/// Resolve a `-c` pattern (optionally `provider:pattern`) to a single context,
/// preferring the cached context list and falling back to a live API call.
async fn resolve_pattern(
    ctx_pattern: &str,
    provider_arg: Option<&str>,
    registry: &PluginRegistry,
) -> Result<crate::plugin::Context> {
    // Support "gcp:novelist-app" syntax — split into provider + pattern.
    let (provider_filter, pattern) = if let Some((prov, pat)) = ctx_pattern.split_once(':') {
        (Some(prov.to_string()), pat.to_string())
    } else {
        (provider_arg.map(|s| s.to_string()), ctx_pattern.to_string())
    };

    let providers: Vec<String> = match provider_filter {
        Some(ref p) => vec![p.clone()],
        None => registry.ids(),
    };
    let mut all_contexts = Vec::new();
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
        Some(m) => Ok(m.context.clone()),
        None => bail!("No context matching '{ctx_pattern}'"),
    }
}
