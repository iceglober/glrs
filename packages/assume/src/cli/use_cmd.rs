use crate::core::daemon::DaemonRequirement;
use crate::core::{audit, config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::plugin::Context;
use crate::tui::picker::{self, PickerResult};
use anyhow::{bail, Result};
use chrono::Utc;
use clap::Args;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::Daemon;

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
    /// Provider to switch context for (e.g., "aws", "gcp")
    pub provider: String,

    /// Profile/context pattern to match (e.g., "dev", "prod/admin", "my-project")
    pub profile: Option<String>,

    /// Pin this context to the current terminal only
    #[arg(long)]
    pub pin: bool,
}

/// Result of collecting contexts for a single provider.
struct CollectResult {
    contexts: Vec<Context>,
    /// True if the provider was skipped due to missing or expired session.
    expired: bool,
}

/// Collect contexts from a single provider.
async fn collect_contexts(
    registry: &PluginRegistry,
    cfg: &config::Config,
    provider_id: &str,
) -> Result<CollectResult> {
    let now = Utc::now();

    let provider = registry
        .get(provider_id)
        .ok_or_else(|| anyhow::anyhow!("Unknown provider: {provider_id}"))?;

    // Check for valid tokens before loading contexts.
    let tokens = match keychain::load_tokens(provider_id)? {
        Some(t) => t,
        None => {
            return Ok(CollectResult {
                contexts: Vec::new(),
                expired: true,
            });
        }
    };
    if tokens.session_expires_at < now && tokens.refresh_expires_at < now {
        return Ok(CollectResult {
            contexts: Vec::new(),
            expired: true,
        });
    }

    // Load contexts from cache (fast) or fall back to live API
    let mut contexts = if let Some(cached) = crate::core::cache::load_contexts(provider_id) {
        cached
    } else {
        match provider.list_contexts(&tokens).await {
            Ok(c) => {
                if let Err(e) = crate::core::cache::save_contexts(provider_id, &c) {
                    tracing::warn!("Failed to cache contexts: {e}");
                }
                c
            }
            Err(e) => {
                eprintln!("Warning: {} — {e}", provider.display_name());
                return Ok(CollectResult {
                    contexts: Vec::new(),
                    expired: false,
                });
            }
        }
    };

    // Merge profile configs if available
    if let Some(provider_cfg) = cfg.providers.get(provider_id) {
        if provider_id == "aws" {
            crate::providers::aws::contexts::merge_profile_configs(
                &mut contexts,
                &provider_cfg.profiles,
            );
        } else if provider_id == "gcp" {
            crate::providers::gcp::contexts::merge_profile_configs(
                &mut contexts,
                &provider_cfg.profiles,
            );
        }
    }

    // Auto-tag dangerous contexts
    if provider_id == "aws" {
        crate::providers::aws::contexts::auto_tag_dangerous(&mut contexts);
    } else if provider_id == "gcp" {
        crate::providers::gcp::contexts::auto_tag_dangerous(&mut contexts);
    }

    Ok(CollectResult {
        contexts,
        expired: false,
    })
}

/// Output environment variable exports for the selected context.
/// This is what the shell wrapper evals to make context per-shell.
pub fn print_context_exports(selected: &Context, cfg: &config::Config) {
    let is_dangerous = selected.tags.contains(&"dangerous".to_string());

    let prompt_label = format!("{}:{}", selected.provider_id, selected.display_name);
    let color = if is_dangerous {
        "red"
    } else if selected.provider_id == "gcp" {
        "blue"
    } else {
        "green"
    };

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

    // Provider-specific env vars
    if selected.provider_id == "aws" {
        // AWS region
        if !selected.region.is_empty() {
            println!("export AWS_REGION=\"{}\"", shell_escape(&selected.region));
            println!(
                "export AWS_DEFAULT_REGION=\"{}\"",
                shell_escape(&selected.region)
            );
        }

        // AWS credential endpoint per-shell
        let port = cfg
            .providers
            .get("aws")
            .and_then(|p| p.port)
            .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);
        let session_token = crate::providers::aws::endpoint::get_or_create_session_token();
        println!(
            "export AWS_CONTAINER_CREDENTIALS_FULL_URI=\"http://localhost:{port}/credentials/{context_id}\"",
            port = port,
            context_id = shell_escape(&selected.id),
        );
        println!(
            "export AWS_CONTAINER_AUTHORIZATION_TOKEN=\"Bearer {}\"",
            shell_escape(&session_token),
        );
    } else if selected.provider_id == "gcp" {
        // GCP project env vars
        let project_id = selected.metadata.get("project_id").unwrap_or(&selected.id);
        println!(
            "export GOOGLE_CLOUD_PROJECT=\"{}\"",
            shell_escape(project_id)
        );
        println!(
            "export CLOUDSDK_CORE_PROJECT=\"{}\"",
            shell_escape(project_id)
        );

        // GCP metadata host
        let port = cfg
            .providers
            .get("gcp")
            .and_then(|p| p.port)
            .unwrap_or(crate::providers::gcp::endpoint::DEFAULT_PORT);
        println!("export GCE_METADATA_HOST=\"localhost:{}\"", port);

        // Export access token so gcloud CLI works without separate auth
        if let Ok(Some(tokens)) = crate::core::keychain::load_tokens("gcp") {
            if let Some(access_token) = tokens.secrets.get("access_token") {
                println!(
                    "export CLOUDSDK_AUTH_ACCESS_TOKEN=\"{}\"",
                    shell_escape(access_token)
                );
            }
        }
    }
}

pub async fn run(args: UseArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    let provider_id = &args.provider;

    // Validate provider exists
    if registry.get(provider_id).is_none() {
        let available = registry.ids().join(", ");
        bail!("Unknown provider: {provider_id}. Available: {available}");
    }

    let active_context_id = crate::core::cache::load_active_context().map(|c| c.id);

    let result = collect_contexts(registry, cfg, provider_id).await?;
    let mut contexts = result.contexts;

    // If no contexts and session expired, auto-launch login and retry.
    if contexts.is_empty() && result.expired {
        eprintln!("No valid session for {provider_id}. Launching login...");
        eprintln!();
        let login_args = super::login::LoginArgs {
            provider: Some(provider_id.clone()),
        };
        super::login::run(login_args, registry, cfg).await?;
        eprintln!();

        // Retry context collection after login
        let retry = collect_contexts(registry, cfg, provider_id).await?;
        contexts = retry.contexts;
    }

    if contexts.is_empty() {
        bail!("No contexts available for {provider_id}. Run: gsa login {provider_id}");
    }

    let selected = match args.profile {
        Some(ref pattern) => {
            let matches = fuzzy::match_contexts(pattern, &contexts);
            match matches.len() {
                0 => bail!("No contexts matching '{pattern}' in {provider_id}"),
                1 => matches[0].context.clone(),
                _ => {
                    // Check if the top match is an exact match
                    if matches[0].score == 1000 {
                        matches[0].context.clone()
                    } else {
                        // Multiple matches — show disambiguation
                        eprintln!("Multiple matches for '{pattern}' in {provider_id}:");
                        for (i, m) in matches.iter().enumerate().take(10) {
                            eprintln!(
                                "  {}. {} {}",
                                i + 1,
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
            // No profile — launch TUI picker filtered to this provider
            match picker::run(&contexts, active_context_id.as_deref())? {
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
            "\x1b[33m!\x1b[0m Context '{}' is tagged as dangerous. Continue? [y/N]: ",
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
            "\x1b[33m!\x1b[0m  Switched to [{}] \x1b[31m{}\x1b[0m ({})",
            selected.provider_id, selected.display_name, selected.region
        );
    } else {
        eprintln!(
            "Switched to [{}] {} ({})",
            selected.provider_id, selected.display_name, selected.region
        );
    }

    // Output env vars to stdout for the shell wrapper to eval
    print_context_exports(&selected, cfg);

    // Persist active context for status command (non-prompt uses)
    if let Err(e) = crate::core::cache::save_active_context(&selected) {
        tracing::warn!("Failed to save active context: {e}");
    }

    // Daemon is already ensured by centralized pre-dispatch in main.rs.
    // Validate the credential endpoint works for the specific context.
    if selected.provider_id == "aws" {
        let port = cfg
            .providers
            .get("aws")
            .and_then(|p| p.port)
            .unwrap_or(crate::providers::aws::endpoint::DEFAULT_PORT);
        let session_token = crate::providers::aws::endpoint::get_or_create_session_token();
        let status =
            crate::core::daemon::validate_credential_endpoint(port, &selected.id, &session_token);

        if status == crate::core::daemon::EndpointStatus::NeedsLogin {
            eprintln!("Session expired. Launching login...");
            eprintln!();
            let login_args = super::login::LoginArgs {
                provider: Some(provider_id.clone()),
            };
            super::login::run(login_args, registry, cfg).await?;
            eprintln!();

            // Restart daemon so it picks up new tokens, then re-validate
            crate::core::daemon::restart_daemon();
            std::thread::sleep(std::time::Duration::from_secs(3));
            let retry = crate::core::daemon::validate_credential_endpoint(
                port,
                &selected.id,
                &session_token,
            );
            if retry != crate::core::daemon::EndpointStatus::Ok {
                eprintln!("Warning: credentials still unavailable after login");
            }
        }
    }

    audit::log_event(
        audit::AuditEvent::ContextSwitch,
        &selected.provider_id,
        &format!("{} -> {}", selected.provider_id, selected.id),
    );

    Ok(())
}
