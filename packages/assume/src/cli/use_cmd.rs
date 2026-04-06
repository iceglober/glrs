use crate::core::{audit, config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::plugin::Context;
use crate::tui::picker::{self, PickerResult};
use anyhow::{bail, Result};
use chrono::Utc;
use clap::Args;

/// Escape a string for safe interpolation inside double-quoted shell values.
/// Prevents injection when the output is `eval`'d by the shell wrapper.
fn shell_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`")
        .replace('!', "\\!")
}

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

/// Result of collecting contexts across providers.
struct CollectResult {
    contexts: Vec<Context>,
    /// Provider IDs that were skipped due to missing or expired sessions.
    expired_providers: Vec<String>,
}

/// Collect contexts from all providers that have a valid session.
async fn collect_contexts(
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<CollectResult> {
    let now = Utc::now();
    let mut contexts = Vec::new();
    let mut expired_providers = Vec::new();

    for provider_id in registry.ids() {
        // Check for valid tokens before loading contexts.
        let tokens = match keychain::load_tokens(&provider_id)? {
            Some(t) => t,
            None => {
                expired_providers.push(provider_id);
                continue;
            }
        };
        if tokens.session_expires_at < now && tokens.refresh_expires_at < now {
            expired_providers.push(provider_id);
            continue;
        }

        let provider = registry.get(&provider_id).unwrap();

        // Load contexts from cache (fast) or fall back to live API
        let mut provider_contexts =
            if let Some(cached) = crate::core::cache::load_contexts(&provider_id) {
                cached
            } else {
                match provider.list_contexts(&tokens).await {
                    Ok(c) => {
                        if let Err(e) = crate::core::cache::save_contexts(&provider_id, &c) {
                            tracing::warn!("Failed to cache contexts: {e}");
                        }
                        c
                    }
                    Err(e) => {
                        eprintln!("Warning: {} — {e}", provider.display_name());
                        continue;
                    }
                }
            };

        // Merge profile configs if available
        if let Some(provider_cfg) = cfg.providers.get(&provider_id) {
            if provider_id == "aws" {
                crate::providers::aws::contexts::merge_profile_configs(
                    &mut provider_contexts,
                    &provider_cfg.profiles,
                );
            }
        }

        // Auto-tag dangerous contexts
        if provider_id == "aws" {
            crate::providers::aws::contexts::auto_tag_dangerous(&mut provider_contexts);
        }

        contexts.extend(provider_contexts);
    }

    Ok(CollectResult {
        contexts,
        expired_providers,
    })
}

pub async fn run(args: UseArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    let active_context_id = crate::core::cache::load_active_context().map(|c| c.id);

    let result = collect_contexts(registry, cfg).await?;
    let mut all_contexts = result.contexts;

    // If no contexts available and providers were skipped due to expired sessions,
    // auto-launch login and retry.
    if all_contexts.is_empty() && !result.expired_providers.is_empty() {
        for provider_id in &result.expired_providers {
            eprintln!("No valid session for {provider_id}. Launching login...");
            eprintln!();
            let login_args = super::login::LoginArgs {
                provider: Some(provider_id.clone()),
            };
            super::login::run(login_args, registry, cfg).await?;
            eprintln!();
        }

        // Retry context collection after login
        let retry = collect_contexts(registry, cfg).await?;
        all_contexts = retry.contexts;
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

    let is_dangerous = selected.tags.contains(&"dangerous".to_string());

    if is_dangerous {
        eprintln!(
            "\x1b[33m⚠\x1b[0m  Switched to [{}] \x1b[31m{}\x1b[0m ({})",
            selected.provider_id, selected.display_name, selected.region
        );
    } else {
        eprintln!(
            "Switched to [{}] {} ({})",
            selected.provider_id, selected.display_name, selected.region
        );
    }

    // Output env vars to stdout for the shell wrapper to eval.
    // This is what makes context per-shell instead of global.
    let prompt_label = format!("{}:{}", selected.provider_id, selected.display_name);
    let color = if is_dangerous { "red" } else { "green" };
    println!(
        "export GS_ASSUME_CONTEXT=\"{}\"",
        shell_escape(&prompt_label)
    );
    println!("export GS_ASSUME_CONTEXT_COLOR=\"{}\"", shell_escape(color));
    println!(
        "export GS_ASSUME_CONTEXT_ID=\"{}\"",
        shell_escape(&selected.id)
    );
    println!(
        "export GS_ASSUME_CONTEXT_PROVIDER=\"{}\"",
        shell_escape(&selected.provider_id)
    );

    // Set AWS_REGION / AWS_DEFAULT_REGION from the context so AWS SDKs know which region to use.
    if !selected.region.is_empty() {
        println!("export AWS_REGION=\"{}\"", shell_escape(&selected.region));
        println!(
            "export AWS_DEFAULT_REGION=\"{}\"",
            shell_escape(&selected.region)
        );
    }

    // Update the credential endpoint URL to include the context ID so each shell
    // gets its own credentials from the daemon (not the global active context).
    if selected.provider_id == "aws" {
        let port = cfg
            .providers
            .get("aws")
            .and_then(|p| p.port)
            .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);
        println!(
            "export AWS_CONTAINER_CREDENTIALS_FULL_URI=\"http://localhost:{port}/credentials/{context_id}\"",
            port = port,
            context_id = shell_escape(&selected.id),
        );
    }

    // Auto-start daemon if not running
    crate::core::daemon::ensure_daemon_running();

    // Persist active context for status command (non-prompt uses)
    if let Err(e) = crate::core::cache::save_active_context(&selected) {
        tracing::warn!("Failed to save active context: {e}");
    }

    audit::log_event(
        audit::AuditEvent::ContextSwitch,
        &selected.provider_id,
        &format!("{} -> {}", selected.provider_id, selected.id),
    );

    Ok(())
}
