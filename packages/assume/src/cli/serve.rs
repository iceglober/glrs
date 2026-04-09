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

    /// Install gs-assume to PATH and start daemon on login
    #[arg(long)]
    pub install: bool,

    /// Uninstall gs-assume and remove login service
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
        eprintln!("Restart your shell, then `gs-assume` and `gsa` will be available everywhere.");
        return Ok(());
    }

    // Check if daemon is already running
    if daemon::is_daemon_running() {
        anyhow::bail!("Daemon is already running. Use 'gs-assume logout' or stop it first.");
    }

    config::ensure_config_dir()?;

    eprintln!("Starting gs-assume daemon...");

    // Write PID file
    daemon::write_pid_file()?;

    // Build shared state
    let state: daemon::SharedDaemonState =
        Arc::new(RwLock::new(daemon::DaemonState::new(cfg, registry)));

    audit::log_event(audit::AuditEvent::DaemonStart, "daemon", "started");

    // Start credential HTTP endpoints
    let _endpoint_handles = daemon::start_credential_endpoints(Arc::clone(&state)).await?;
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

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;

    eprintln!("\nShutting down...");
    audit::log_event(audit::AuditEvent::DaemonStop, "daemon", "stopped");
    daemon::remove_pid_file();
    daemon::remove_socket_file();

    Ok(())
}
