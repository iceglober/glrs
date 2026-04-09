use crate::core::daemon::DaemonRequirement;
use crate::core::{config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

#[derive(Args, Debug)]
pub struct ConsoleArgs {
    /// Context pattern (e.g., "aws:staging", "gcp:analytics")
    pub pattern: Option<String>,
}

pub async fn run(
    args: ConsoleArgs,
    registry: &PluginRegistry,
    _cfg: &config::Config,
) -> Result<()> {
    // Collect all contexts
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

    if all_contexts.is_empty() {
        bail!("No contexts available. Run: gs-assume login <provider>");
    }

    let context = match args.pattern {
        Some(ref pattern) => {
            let matches = fuzzy::match_contexts(pattern, &all_contexts);
            match matches.first() {
                Some(m) => m.context.clone(),
                None => bail!("No context matching '{pattern}'"),
            }
        }
        None => bail!("Specify a context: gs-assume console <pattern>"),
    };

    let provider = registry
        .get(&context.provider_id)
        .ok_or_else(|| anyhow::anyhow!("Provider not found: {}", context.provider_id))?;

    let tokens = keychain::load_tokens(&context.provider_id)?
        .ok_or_else(|| anyhow::anyhow!("Not authenticated for {}", context.provider_id))?;

    let credentials = provider
        .get_credentials(&tokens, &context)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get credentials: {e}"))?;

    let url = provider
        .console_url(&context, &credentials)
        .map_err(|e| anyhow::anyhow!("Failed to generate console URL: {e}"))?;

    eprintln!(
        "Opening {} console for {}...",
        provider.display_name(),
        context.display_name
    );

    open::that(&url)?;

    Ok(())
}
