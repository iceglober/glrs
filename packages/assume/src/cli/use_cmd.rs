use crate::core::{audit, config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::tui::picker::{self, PickerResult};
use anyhow::{bail, Result};
use clap::Args;

#[derive(Args, Debug)]
pub struct UseArgs {
    /// Context pattern to match (e.g., "dev", "aws:prod/admin")
    pub pattern: Option<String>,

    /// Pin this context to the current terminal only
    #[arg(long)]
    pub pin: bool,

    /// Restrict search to a specific provider
    #[arg(long)]
    pub provider: Option<String>,
}

pub async fn run(args: UseArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    // Collect all contexts across all providers
    let mut all_contexts = Vec::new();
    let active_context_id: Option<String> = None;

    for provider_id in registry.ids() {
        let provider = registry.get(&provider_id).unwrap();
        let tokens = match keychain::load_tokens(&provider_id)? {
            Some(t) => t,
            None => continue,
        };

        match provider.list_contexts(&tokens).await {
            Ok(mut contexts) => {
                // Merge profile configs if available
                if let Some(provider_cfg) = cfg.providers.get(&provider_id) {
                    if provider_id == "aws" {
                        crate::providers::aws::contexts::merge_profile_configs(
                            &mut contexts,
                            &provider_cfg.profiles,
                        );
                    }
                }
                all_contexts.extend(contexts);
            }
            Err(e) => {
                eprintln!("Warning: {} — {e}", provider.display_name());
            }
        }
    }

    if all_contexts.is_empty() {
        bail!("No contexts available. Run: gs-assume login <provider>");
    }

    // Apply provider filter from flag
    if let Some(ref pf) = args.provider {
        all_contexts.retain(|c| c.provider_id == *pf);
        if all_contexts.is_empty() {
            bail!("No contexts available for provider: {pf}");
        }
    }

    let selected = match args.pattern {
        Some(ref pattern) => {
            let matches = fuzzy::match_contexts(pattern, &all_contexts);
            match matches.len() {
                0 => bail!("No contexts matching '{pattern}'"),
                1 => matches[0].context.clone(),
                _ => {
                    // Check if the top match is an exact match
                    if matches[0].score == 1000 {
                        matches[0].context.clone()
                    } else {
                        // Multiple matches — show disambiguation
                        eprintln!("Multiple matches for '{pattern}':");
                        for (i, m) in matches.iter().enumerate().take(10) {
                            let provider = &m.context.provider_id;
                            eprintln!(
                                "  {}. [{}] {} {}",
                                i + 1,
                                provider,
                                m.context.display_name,
                                m.context.region
                            );
                        }

                        // Read selection from stdin
                        eprint!("Select [1-{}]: ", matches.len().min(10));
                        let mut input = String::new();
                        std::io::stdin().read_line(&mut input)?;
                        let idx: usize = input.trim().parse().unwrap_or(0);
                        if idx == 0 || idx > matches.len().min(10) {
                            bail!("Invalid selection");
                        }
                        matches[idx - 1].context.clone()
                    }
                }
            }
        }
        None => {
            // No pattern — launch TUI picker
            match picker::run(&all_contexts, active_context_id.as_deref())? {
                PickerResult::Selected(ctx) => ctx,
                PickerResult::Cancelled => {
                    eprintln!("Cancelled");
                    return Ok(());
                }
            }
        }
    };

    // Check if context requires confirmation
    if selected.tags.contains(&"dangerous".to_string()) {
        eprint!(
            "⚠ Context '{}' is tagged as dangerous. Continue? [y/N]: ",
            selected.display_name
        );
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        if !input.trim().eq_ignore_ascii_case("y") {
            eprintln!("Aborted");
            return Ok(());
        }
    }

    eprintln!(
        "Switched to [{}] {} ({})",
        selected.provider_id, selected.display_name, selected.region
    );

    audit::log_event(
        audit::AuditEvent::ContextSwitch,
        &selected.provider_id,
        &format!("{} -> {}", selected.provider_id, selected.id),
    );

    Ok(())
}
