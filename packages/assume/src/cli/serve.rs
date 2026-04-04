use crate::core::{audit, config, daemon, rpc};
use crate::plugin::registry::PluginRegistry;
use anyhow::Result;
use clap::Args;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Args, Debug)]
pub struct ServeArgs {
    /// Run in foreground (default: daemonize)
    #[arg(long)]
    pub foreground: bool,

    /// AWS ECS endpoint port
    #[arg(long, default_value_t = 9911)]
    pub aws_port: u16,

    /// GCP metadata server port
    #[arg(long, default_value_t = 9912)]
    pub gcp_port: u16,
}

pub async fn run(_args: ServeArgs, registry: PluginRegistry, cfg: config::Config) -> Result<()> {
    // Check if daemon is already running
    if daemon::is_daemon_running() {
        anyhow::bail!("Daemon is already running. Use 'gs-assume logout' or stop it first.");
    }

    config::ensure_config_dir()?;

    eprintln!("Starting gs-assume daemon...");

    // Write PID file
    daemon::write_pid_file()?;

    // Build shared state
    let state: daemon::SharedDaemonState = Arc::new(RwLock::new(
        daemon::DaemonState::new(cfg, registry),
    ));

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
    eprintln!("RPC listener started on {}", config::socket_path().display());

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
