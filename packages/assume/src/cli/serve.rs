use crate::core::daemon::DaemonRequirement;
use crate::core::{audit, config, daemon, rpc};
use crate::plugin::registry::PluginRegistry;
use anyhow::Result;
use clap::Args;
use std::sync::Arc;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;
use tokio::sync::RwLock;

#[derive(Args, Debug)]
pub struct ServeArgs {
    /// Run in foreground (default: daemonize)
    #[arg(long)]
    pub foreground: bool,

    /// Install glrs-assume to PATH and start daemon on login
    #[arg(long)]
    pub install: bool,

    /// Uninstall glrs-assume and remove login service
    #[arg(long)]
    pub uninstall: bool,
}

pub async fn run(args: ServeArgs, registry: PluginRegistry, cfg: config::Config) -> Result<()> {
    if args.uninstall {
        let actions = daemon::uninstall()?;
        if actions.is_empty() {
            eprintln!("Nothing to uninstall.");
        } else {
            for action in &actions {
                eprintln!("  {action}");
            }
            eprintln!("Done. Restart your shell for PATH changes to take effect.");
        }
        return Ok(());
    }

    if args.install {
        let actions = daemon::install()?;
        for action in &actions {
            eprintln!("  {action}");
        }
        eprintln!();
        eprintln!("Restart your shell, then `glrs-assume` and `gsa` will be available everywhere.");
        return Ok(());
    }

    // Check if daemon is already running
    let action = daemon::serve_action_for_current_state();
    match action {
        daemon::ServeAction::NoopHealthy => {
            eprintln!("glrs-assume daemon already running and healthy; exiting 0.");
            return Ok(());
        }
        daemon::ServeAction::RemoveStalePidAndStart => {
            // Don't remove the PID file yet — reclaim it only after we've bound
            // the credential port. If another daemon actually owns the port, we
            // exit without disturbing its PID file.
            tracing::warn!(
                "Stale PID file present; will reclaim after binding the credential port"
            );
        }
        daemon::ServeAction::StartFresh => {
            // Continue with normal startup
        }
    }

    // Truncate oversized log file before starting
    let log_path = config::config_dir().join("daemon.stderr.log");
    if let Err(e) = daemon::truncate_oversized_log(&log_path, 10 * 1024 * 1024) {
        tracing::warn!("Failed to truncate log file: {e}");
    }

    config::ensure_config_dir()?;

    eprintln!("Starting glrs-assume daemon...");

    // Build shared state (loads tokens/contexts from disk; no network, no ports).
    let state: daemon::SharedDaemonState =
        Arc::new(RwLock::new(daemon::DaemonState::new(cfg, registry)));

    // Bind the credential port(s) FIRST — this is the daemon singleton gate. If
    // another daemon already owns the port (a startup race, or a second install
    // firing its own daemon), the bind reports "already served" and we exit 0
    // without touching the PID file, so the real owner stays authoritative and no
    // headless orphan accumulates.
    let bound = match daemon::bind_credential_endpoints(&state).await? {
        Some(b) => b,
        None => {
            eprintln!("Another glrs-assume daemon already owns the credential port; exiting 0.");
            return Ok(());
        }
    };

    // We own the port — claim the PID file (overwriting any stale entry) and
    // record our version so CLI invocations can detect a stale daemon left behind
    // by an auto-upgrade and cycle it.
    daemon::write_pid_file()?;
    daemon::write_daemon_version();

    audit::log_event(audit::AuditEvent::DaemonStart, "daemon", "started");

    // Start the accept loops on the already-bound listeners.
    let _endpoint_handles = daemon::serve_bound_endpoints(bound, Arc::clone(&state));
    eprintln!("Credential endpoints started");

    // Start RPC listener
    let rpc_state = Arc::clone(&state);
    let _rpc_handle = tokio::spawn(async move {
        if let Err(e) = rpc::start_rpc_listener(rpc_state).await {
            tracing::error!("RPC listener failed: {e}");
        }
    });
    eprintln!(
        "RPC listener started on {}",
        config::socket_path().display()
    );

    // Start refresh loop
    let refresh_state = Arc::clone(&state);
    let _refresh_handle = tokio::spawn(async move {
        daemon::run_refresh_loop(refresh_state).await;
    });

    eprintln!("Daemon ready. Press Ctrl+C to stop.");

    // Wait for SIGINT or SIGTERM (launchd sends SIGTERM on shutdown)
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = sigterm.recv() => {}
    }

    eprintln!("\nShutting down...");
    audit::log_event(audit::AuditEvent::DaemonStop, "daemon", "stopped");
    daemon::remove_pid_file();
    daemon::remove_socket_file();
    daemon::remove_daemon_version();

    Ok(())
}
