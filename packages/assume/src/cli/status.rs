use crate::core::{config, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::shell::prompt;
use anyhow::Result;
use chrono::Utc;
use clap::Args;

#[derive(Args, Debug)]
pub struct StatusArgs {
    /// Output only prompt segments (for shell integration)
    #[arg(long)]
    pub prompt: bool,
}

pub async fn run(args: StatusArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    if args.prompt {
        return print_prompt_segments(registry, cfg).await;
    }

    let now = Utc::now();
    let mut any_active = false;

    for provider_id in registry.ids() {
        let provider = registry.get(&provider_id).unwrap();

        let tokens = match keychain::load_tokens(&provider_id)? {
            Some(t) => t,
            None => {
                println!("{}", provider.display_name());
                println!("  Status: not authenticated");
                println!("  Run: gs-assume login {provider_id}");
                println!();
                continue;
            }
        };

        any_active = true;
        println!("{}", provider.display_name());

        // Session token status
        let session_remaining = tokens.session_expires_at.signed_duration_since(now);
        if session_remaining.num_seconds() > 0 {
            println!("  SSO token: {}", format_duration(session_remaining));
        } else {
            println!("  SSO token: expired");
        }

        // Refresh token status
        let refresh_remaining = tokens.refresh_expires_at.signed_duration_since(now);
        if refresh_remaining.num_days() > 365 {
            println!("  Refresh token: never expires");
        } else if refresh_remaining.num_seconds() > 0 {
            println!("  Refresh token: {}", format_duration(refresh_remaining));
        } else {
            println!("  Refresh token: expired");
            println!("  Run: gs-assume login {provider_id}");
        }

        // Show active context
        if let Some(ref active) = crate::core::cache::load_active_context() {
            if active.provider_id == provider_id {
                println!(
                    "  Active context: {} ({})",
                    active.display_name, active.region
                );
            }
        }

        println!();
    }

    if !any_active {
        println!("No active sessions. Run: gs-assume login <provider>");
    }

    // Daemon status
    if crate::core::daemon::is_daemon_running() {
        println!("Daemon: running");
    } else {
        println!("Daemon: not running");
    }

    Ok(())
}

async fn print_prompt_segments(registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    // Read active context from disk — must be instant for shell prompt
    if let Some(ctx) = crate::core::cache::load_active_context() {
        if let Some(provider) = registry.get(&ctx.provider_id) {
            let segment = provider.prompt_segment(&ctx);
            print!("{}", prompt::format_segment(&segment));
        }
    }
    Ok(())
}

fn format_duration(d: chrono::Duration) -> String {
    let total_secs = d.num_seconds();
    if total_secs < 0 {
        return "expired".to_string();
    }

    let days = total_secs / 86400;
    let hours = (total_secs % 86400) / 3600;
    let minutes = (total_secs % 3600) / 60;

    if days > 0 {
        format!("{days} day(s) {hours} hour(s) remaining")
    } else if hours > 0 {
        format!("{hours} hour(s) {minutes} minute(s) remaining")
    } else {
        format!("{minutes} minute(s) remaining")
    }
}
