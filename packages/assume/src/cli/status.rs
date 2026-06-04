use crate::core::daemon::DaemonRequirement;
use crate::core::{config, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::shell::prompt;
use anyhow::Result;
use chrono::Utc;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::BackgroundEnsure;
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
    let daemon_running = crate::core::daemon::is_daemon_running();
    let mut any_active = false;

    for provider_id in registry.ids() {
        let provider = registry.get(&provider_id).unwrap();

        let tokens = match keychain::load_tokens(&provider_id)? {
            Some(t) => t,
            None => {
                println!("{}", provider.display_name());
                println!("  Status: not authenticated");
                println!("  Run: gsa login {provider_id}");
                println!();
                continue;
            }
        };

        any_active = true;
        println!("{}", provider.display_name());

        // SSO token + auto-refresh state.
        //
        // We deliberately do NOT print a "refresh token expires in N days"
        // countdown: AWS never reports the refresh token's real lifetime, so any
        // number here is fabricated (it used to hardcode 7 days and mislead).
        // What we can state truthfully: while the session is live the daemon
        // keeps the SSO token fresh; once it shows expired, auto-refresh has hit
        // the org's SSO session limit and re-login is required.
        let session_remaining = tokens.session_expires_at.signed_duration_since(now);
        if session_remaining.num_seconds() > 0 {
            println!("  SSO token: {}", format_duration(session_remaining));
            if daemon_running {
                println!("  Auto-refresh: on");
            } else {
                println!("  Auto-refresh: off (daemon not running)");
            }
        } else {
            // A running daemon refreshes within the expiry buffer, so an expired
            // token here means auto-refresh could not renew it — the SSO session
            // reached its limit (capped server-side, duration not reported) or
            // was revoked. Re-login is the only fix.
            println!("  SSO token: expired");
            println!("  SSO session ended — run: gsa login {provider_id}");
        }

        // Show this provider's default (ambient) context
        if let Some(ref default_ctx) = crate::core::cache::load_default(&provider_id) {
            println!(
                "  Default context: {} ({})",
                default_ctx.display_name, default_ctx.region
            );
        }

        println!();
    }

    if !any_active {
        println!("No active sessions. Run: gsa login <provider>");
    }

    // Daemon status
    if daemon_running {
        println!("Daemon: running");
    } else {
        println!("Daemon: not running");
    }

    nudge_shell_integration();

    Ok(())
}

/// Point users at shell-integration install when it's missing. Without the rc
/// wrapper, `gsa use` / `gsa login` can't set per-shell context — and an
/// auto-upgraded binary won't have it wired until the user does so. Nothing
/// else surfaces this, so `status` is where we catch the installed base.
///
/// Skipped when invoked through the wrapper (`GLRS_CLI_DISPATCHED` set) — that
/// proves integration is already active, even if it lives in a non-default rc.
fn nudge_shell_integration() {
    if std::env::var_os("GLRS_CLI_DISPATCHED").is_some() {
        return;
    }
    let Some(shell) = super::shell_init::detect_shell() else {
        return; // can't name the rc file or the install command — stay quiet
    };
    if super::shell_init::integration_block_present(&shell) {
        return;
    }
    println!();
    println!("Shell integration not detected — `gsa use` / `gsa login` can't switch this shell.");
    println!("  Enable it: gsa shell-init --install {shell}");
}

async fn print_prompt_segments(registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    // Render one segment per provider's default. The installed shell integration
    // reads GLRS_ASSUME_SEGMENTS directly (no subprocess); this `--prompt` path is
    // a convenience for inspecting what the prompt would show.
    let segments: Vec<_> = crate::core::cache::load_all_defaults()
        .into_iter()
        .filter_map(|ctx| {
            registry
                .get(&ctx.provider_id)
                .map(|p| p.prompt_segment(&ctx))
        })
        .collect();
    print!("{}", prompt::format_prompt(&segments));
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
