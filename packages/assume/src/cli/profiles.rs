use crate::core::{config, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::Result;
use clap::Args;

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
        let tokens = match keychain::load_tokens(&provider_id)? {
            Some(t) => t,
            None => {
                eprintln!("{}: not authenticated", provider.display_name());
                continue;
            }
        };

        let mut contexts = match provider.list_contexts(&tokens).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("{}: {e}", provider.display_name());
                continue;
            }
        };

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

        for ctx in &contexts {
            let alias = ctx.metadata.get("alias").map(String::as_str).unwrap_or("-");
            let tags_str = if ctx.tags.is_empty() {
                String::new()
            } else {
                format!(" [{}]", ctx.tags.join(", "))
            };

            if provider_id == "aws" {
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
                println!(
                    "{:<30} {:<25} {:<15} {}{}",
                    account, role, alias, ctx.region, tags_str
                );
            } else {
                println!(
                    "{:<40} {:<15} {}{}",
                    ctx.display_name, alias, ctx.region, tags_str
                );
            }
        }
        println!();
    }

    if !found_any {
        println!("No profiles available. Run: gs-assume login <provider>");
    }

    Ok(())
}
