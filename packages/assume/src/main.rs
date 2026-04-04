use assume::cli;
use assume::core::config;
use assume::plugin::registry::PluginRegistry;
use assume::providers::aws::AwsProvider;
use assume::providers::gcp::GcpProvider;
use clap::{Parser, Subcommand};
use std::sync::Arc;

#[derive(Parser)]
#[command(
    name = "gs-assume",
    version,
    about = "Unified credential assume manager — authenticate once, work all day"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Authenticate with a cloud provider
    Login(cli::login::LoginArgs),
    /// Switch active context (account/role/project)
    #[command(name = "use")]
    Use(cli::use_cmd::UseArgs),
    /// Show current authentication status
    Status(cli::status::StatusArgs),
    /// List available profiles/contexts
    Profiles(cli::profiles::ProfilesArgs),
    /// Re-fetch contexts from providers
    Sync(cli::sync::SyncArgs),
    /// Run a command with injected credentials
    Exec(cli::exec::ExecArgs),
    /// Start the credential daemon
    Serve(cli::serve::ServeArgs),
    /// Clear stored credentials
    Logout(cli::logout::LogoutArgs),
    /// Print shell integration script
    ShellInit(cli::shell_init::ShellInitArgs),
    /// Open provider's web console
    Console(cli::console::ConsoleArgs),
    /// Output credentials for AWS credential_process
    CredentialProcess(cli::credential_process::CredentialProcessArgs),
    /// Update gs-assume to the latest version
    Upgrade(cli::upgrade::UpgradeArgs),
}

fn build_registry(cfg: &config::Config) -> anyhow::Result<PluginRegistry> {
    let mut registry = PluginRegistry::new();

    // Register AWS if enabled (or if no providers are configured, enable by default)
    let aws_enabled = cfg.providers.get("aws").map(|p| p.enabled).unwrap_or(true);
    if aws_enabled {
        let aws_config = cfg.providers.get("aws").cloned().unwrap_or_default();
        let aws = AwsProvider::from_config(&aws_config);
        registry.register(Arc::new(aws))?;
    }

    // Register GCP if explicitly enabled
    let gcp_enabled = cfg.providers.get("gcp").map(|p| p.enabled).unwrap_or(false);
    if gcp_enabled {
        let gcp = GcpProvider::new();
        registry.register(Arc::new(gcp))?;
    }

    Ok(registry)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let cfg = config::load_config()?;
    let registry = build_registry(&cfg)?;

    // Check for updates (skip if running upgrade itself)
    if !matches!(cli.command, Commands::Upgrade(_)) {
        assume::core::update_check::check_for_update();
    }

    match cli.command {
        Commands::Login(args) => cli::login::run(args, &registry, &cfg).await,
        Commands::Use(args) => cli::use_cmd::run(args, &registry, &cfg).await,
        Commands::Status(args) => cli::status::run(args, &registry, &cfg).await,
        Commands::Profiles(args) => cli::profiles::run(args, &registry, &cfg).await,
        Commands::Sync(args) => cli::sync::run(args, &registry, &cfg).await,
        Commands::Exec(args) => cli::exec::run(args, &registry, &cfg).await,
        Commands::Serve(args) => cli::serve::run(args, registry, cfg).await,
        Commands::Logout(args) => cli::logout::run(args, &registry).await,
        Commands::ShellInit(args) => cli::shell_init::run(args, &registry, &cfg).await,
        Commands::Console(args) => cli::console::run(args, &registry, &cfg).await,
        Commands::CredentialProcess(args) => {
            cli::credential_process::run(args, &registry, &cfg).await
        }
        Commands::Upgrade(args) => cli::upgrade::run(args).await,
    }
}
