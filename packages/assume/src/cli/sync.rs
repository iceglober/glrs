use crate::core::{config, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;

#[derive(Args, Debug)]
pub struct SyncArgs {
    /// Provider to sync (omit for all providers)
    pub provider: Option<String>,
}

pub async fn run(args: SyncArgs, registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    let provider_ids: Vec<String> = match args.provider {
        Some(ref id) => {
            if registry.get(id).is_none() {
                bail!("Unknown provider: {id}");
            }
            vec![id.clone()]
        }
        None => registry.ids(),
    };

    for provider_id in &provider_ids {
        let provider = registry.get(provider_id).unwrap();

        let tokens = match keychain::load_tokens(provider_id)? {
            Some(t) => t,
            None => {
                eprintln!(
                    "{}: not authenticated. Run: gs-assume login {provider_id}",
                    provider.display_name()
                );
                continue;
            }
        };

        eprintln!("Syncing {} contexts...", provider.display_name());

        match provider.list_contexts(&tokens).await {
            Ok(contexts) => {
                eprintln!(
                    "{}: {} context(s) discovered",
                    provider.display_name(),
                    contexts.len()
                );
                for ctx in &contexts {
                    let alias = ctx
                        .metadata
                        .get("alias")
                        .map(|a| format!(" ({})", a))
                        .unwrap_or_default();
                    eprintln!("  {} {}{}", ctx.display_name, ctx.region, alias);
                }

                // Update cache
                if let Err(e) = crate::core::cache::save_contexts(provider_id, &contexts) {
                    tracing::warn!("Failed to cache contexts: {e}");
                }
            }
            Err(crate::plugin::ProviderError::AccessTokenExpired) => {
                eprintln!(
                    "{}: access token expired, attempting refresh...",
                    provider.display_name()
                );
                match provider.refresh(&tokens).await {
                    Ok(new_tokens) => {
                        keychain::store_tokens(provider_id, &new_tokens)?;
                        match provider.list_contexts(&new_tokens).await {
                            Ok(contexts) => {
                                eprintln!(
                                    "{}: {} context(s) after refresh",
                                    provider.display_name(),
                                    contexts.len()
                                );

                                // Update cache
                                if let Err(e) = crate::core::cache::save_contexts(provider_id, &contexts) {
                                    tracing::warn!("Failed to cache contexts: {e}");
                                }
                            }
                            Err(e) => eprintln!(
                                "{}: failed to list after refresh: {e}",
                                provider.display_name()
                            ),
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "{}: refresh failed: {e}. Run: gs-assume login {provider_id}",
                            provider.display_name()
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!("{}: failed to sync: {e}", provider.display_name());
            }
        }
    }

    Ok(())
}
