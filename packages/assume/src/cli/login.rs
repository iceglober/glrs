use crate::core::{audit, config, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;

#[derive(Args, Debug)]
pub struct LoginArgs {
    /// Provider to authenticate with (e.g., "aws", "gcp")
    pub provider: Option<String>,
}

pub async fn run(args: LoginArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    let provider_id = match args.provider {
        Some(ref id) => id.clone(),
        None => {
            // If only one provider is enabled, use it
            let ids = registry.ids();
            if ids.len() == 1 {
                ids[0].clone()
            } else {
                eprintln!("Available providers: {}", ids.join(", "));
                bail!("Specify a provider: gs-assume login <provider>");
            }
        }
    };

    let provider = registry
        .get(&provider_id)
        .ok_or_else(|| anyhow::anyhow!("Unknown provider: {provider_id}"))?;

    let provider_config = cfg.providers.get(&provider_id).cloned().unwrap_or_default();

    eprintln!("Logging in to {}...", provider.display_name());

    let tokens = provider
        .login(&provider_config)
        .await
        .map_err(|e| anyhow::anyhow!("{} login failed: {e}", provider.display_name()))?;

    // Store tokens in keychain
    keychain::store_tokens(&provider_id, &tokens)?;

    // Discover available contexts
    eprintln!("Discovering available contexts...");
    match provider.list_contexts(&tokens).await {
        Ok(contexts) => {
            eprintln!(
                "Authenticated as {} — {} context(s) available",
                provider.display_name(),
                contexts.len()
            );
            // Show summary of discovered contexts
            for ctx in &contexts {
                let alias = ctx
                    .metadata
                    .get("alias")
                    .map(|a| format!(" ({})", a))
                    .unwrap_or_default();
                eprintln!("  {} {}{}", ctx.display_name, ctx.region, alias);
            }
        }
        Err(e) => {
            eprintln!("Warning: Failed to list contexts: {e}");
            eprintln!("You can try: gs-assume sync {provider_id}");
        }
    }

    let expires = tokens.session_expires_at.format("%Y-%m-%d %H:%M UTC");
    eprintln!("Session valid until {expires}");

    audit::log_event(
        audit::AuditEvent::Login,
        &provider_id,
        provider.display_name(),
    );

    Ok(())
}
