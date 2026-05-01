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
    about = "Unified credential assume manager for AWS and GCP — authenticate once, work all day",
    after_help = "\x1b[1mQuick start:\x1b[0m
  gsa login aws                              # Authenticate with AWS (browser SSO)
  gsa login gcp                              # Authenticate with GCP (browser OAuth)
  gsa use aws <profile>                      # Switch AWS context (interactive shell)
  gsa use gcp <project>                      # Switch GCP context (interactive shell)

\x1b[1mFor scripts and AI agents (non-interactive):\x1b[0m
  gsa exec -- <command>                      # Run with active context credentials
  gsa exec -p prod/admin -- <command>        # Run with a specific profile
  gsa exec -p gcp:my-project -- <command>    # Shorthand for --provider gcp --profile

\x1b[1mExamples:\x1b[0m
  gsa exec -- terraform apply                # Uses active context
  gsa exec -p prod/admin -- aws sts get-caller-identity
  gsa exec -p gcp:my-project -- gcloud projects list
  gsa exec --provider aws -- aws s3 ls       # Active context, narrowed to AWS"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Agent access management and MCP server
    Agent(cli::agent::AgentArgs),
    /// Authenticate with a cloud provider (opens browser)
    Login(cli::login::LoginArgs),
    /// Switch active context — requires shell eval, use 'exec' for scripts/agents
    #[command(name = "use")]
    Use(cli::use_cmd::UseArgs),
    /// Show current authentication status
    Status(cli::status::StatusArgs),
    /// List available profiles/contexts
    Profiles(cli::profiles::ProfilesArgs),
    /// Re-fetch contexts from providers
    Sync(cli::sync::SyncArgs),
    /// Run a command with injected credentials (best for scripts and AI agents)
    Exec(cli::exec::ExecArgs),
    /// Start the credential daemon
    Serve(cli::serve::ServeArgs),
    /// Clear stored credentials
    Logout(cli::logout::LogoutArgs),
    /// Print shell integration script
    ShellInit(cli::shell_init::ShellInitArgs),
    /// View or modify configuration
    Config(cli::config_cmd::ConfigArgs),
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

    // Register GCP (enabled by default — interactive setup runs on first login)
    let gcp_enabled = cfg.providers.get("gcp").map(|p| p.enabled).unwrap_or(true);
    if gcp_enabled {
        let gcp_config = cfg.providers.get("gcp").cloned().unwrap_or_default();
        let gcp = GcpProvider::from_config(&gcp_config);
        registry.register(Arc::new(gcp))?;
    }

    Ok(registry)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {

    // Initialize tracing with a default filter if RUST_LOG is not set
    // Default: info level for our code, warn for hyper (too verbose at info)
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,hyper=warn"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let cfg = config::load_config()?;
    let registry = build_registry(&cfg)?;

    // Check for updates (skip if running upgrade itself)
    if !matches!(cli.command, Commands::Upgrade(_)) {
        assume::core::update_check::check_for_update();
    }

    // Centralized pre-dispatch: ensure daemon is running for commands that need it.
    // This exhaustive match forces every new Commands variant to be classified —
    // the compiler rejects unhandled variants, preventing accidental omissions.
    use assume::core::daemon::DaemonRequirement;
    let requirement = match &cli.command {
        Commands::Use(_) => cli::use_cmd::REQUIREMENT,
        Commands::Agent(_) => cli::agent::REQUIREMENT,
        Commands::Exec(_) => cli::exec::REQUIREMENT,
        Commands::CredentialProcess(_) => cli::credential_process::REQUIREMENT,
        Commands::Serve(_) => cli::serve::REQUIREMENT,
        Commands::Login(_) => cli::login::REQUIREMENT,
        Commands::Logout(_) => cli::logout::REQUIREMENT,
        Commands::Status(_) => cli::status::REQUIREMENT,
        Commands::Profiles(_) => cli::profiles::REQUIREMENT,
        Commands::Sync(_) => cli::sync::REQUIREMENT,
        Commands::Config(_) => cli::config_cmd::REQUIREMENT,
        Commands::Console(_) => cli::console::REQUIREMENT,
        Commands::ShellInit(_) => cli::shell_init::REQUIREMENT,
        Commands::Upgrade(_) => cli::upgrade::REQUIREMENT,
    };
    if requirement == DaemonRequirement::Daemon {
        assume::core::daemon::ensure_daemon_running();
    }

    match cli.command {
        Commands::Agent(args) => cli::agent::run(args, &registry, &cfg).await,
        Commands::Config(args) => cli::config_cmd::run(args).await,
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
