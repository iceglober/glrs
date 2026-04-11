use crate::core::daemon::DaemonRequirement;
use crate::core::{config, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::Result;
use clap::Args;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

#[derive(Args, Debug)]
pub struct ProfilesArgs {
    /// Filter by provider
    pub provider: Option<String>,
}

pub async fn run(
    args: ProfilesArgs,
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<()> {
    let mut found_any = false;

    for provider_id in registry.ids() {
        if let Some(ref filter) = args.provider {
            if &provider_id != filter {
                continue;
            }
        }

        let provider = registry.get(&provider_id).unwrap();

        // Load contexts from cache (fast) or fall back to live API
        let mut contexts = if let Some(cached) = crate::core::cache::load_contexts(&provider_id) {
            cached
        } else {
            // No cache — need tokens for live API call
            let tokens = match keychain::load_tokens(&provider_id)? {
                Some(t) => t,
                None => {
                    eprintln!("{}: not authenticated", provider.display_name());
                    continue;
                }
            };
            match provider.list_contexts(&tokens).await {
                Ok(c) => {
                    if let Err(e) = crate::core::cache::save_contexts(&provider_id, &c) {
                        tracing::warn!("Failed to cache contexts: {e}");
                    }
                    c
                }
                Err(e) => {
                    eprintln!("{}: {e}", provider.display_name());
                    continue;
                }
            }
        };

        // Auto-tag dangerous contexts
        if provider_id == "aws" {
            crate::providers::aws::contexts::auto_tag_dangerous(&mut contexts);
        }

        // Merge profile configs
        if let Some(provider_cfg) = cfg.providers.get(&provider_id) {
            if provider_id == "aws" {
                crate::providers::aws::contexts::merge_profile_configs(
                    &mut contexts,
                    &provider_cfg.profiles,
                );
            }
        }

        if contexts.is_empty() {
            continue;
        }

        found_any = true;

        if args.provider.is_none() {
            println!("{}", provider.display_name());
            println!("{}", "-".repeat(70));
        }

        // Print header based on provider
        if provider_id == "aws" {
            println!("{:<30} {:<25} {:<15} Region", "Account", "Role", "Alias",);
        } else {
            println!("{:<40} {:<15} Region", "Context", "Alias",);
        }

        // Check active context
        let active_id = crate::core::cache::load_active_context().map(|c| c.id);

        for ctx in &contexts {
            let alias = ctx.metadata.get("alias").map(String::as_str).unwrap_or("-");
            let is_dangerous = ctx.tags.contains(&"dangerous".to_string());
            let is_active = active_id.as_deref() == Some(ctx.id.as_str());
            let marker = if is_active {
                "\x1b[32m● \x1b[0m"
            } else {
                "  "
            };

            let line = if provider_id == "aws" {
                let account = ctx
                    .metadata
                    .get("account_name")
                    .map(String::as_str)
                    .unwrap_or("?");
                let role = ctx
                    .metadata
                    .get("role_name")
                    .map(String::as_str)
                    .unwrap_or("?");
                format!("{:<28} {:<25} {:<15} {}", account, role, alias, ctx.region)
            } else {
                format!("{:<38} {:<15} {}", ctx.display_name, alias, ctx.region)
            };

            if is_dangerous {
                println!("{marker}\x1b[31m{line} ⚠ dangerous\x1b[0m");
            } else {
                println!("{marker}{line}");
            }
        }
        println!();
    }

    if !found_any {
        println!("No profiles available. Run: gsa login <provider>");
    }

    Ok(())
}
