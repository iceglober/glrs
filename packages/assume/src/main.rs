use assume::cli;
use assume::core::config;
use assume::plugin::registry::PluginRegistry;
use assume::providers::aws::AwsProvider;
use assume::providers::gcp::GcpProvider;
use clap::{Parser, Subcommand};
use std::sync::Arc;

#[derive(Parser)]
#[command(
    name = "glrs-assume",
    version,
    about = "Unified credential assume manager for AWS and GCP — authenticate once, work all day",
    after_help = "\x1b[1mQuick start:\x1b[0m
  gsa init                                   # One-time setup: login, approve agent contexts, pick a default context
  aws s3 ls                                  # Just works — the daemon serves your default context's credentials
  gsa use aws <context>                       # Switch this shell to another AWS context
  gsa use gcp <project>                      # Switch this shell to a GCP project

  (Until 'gsa init' completes, only init/upgrade/shell-init/status/config run.)

\x1b[1mFor scripts and AI agents (non-interactive):\x1b[0m
  gsa exec -- <command>                      # Run with active context credentials
  gsa exec -c prod/admin -- <command>        # Run with a specific context
  gsa exec -c gcp:my-project -- <command>    # Shorthand for --provider gcp --context

\x1b[1mExamples:\x1b[0m
  gsa exec -- terraform apply                # Uses active context
  gsa exec -c prod/admin -- aws sts get-caller-identity
  gsa exec -c gcp:my-project -- gcloud projects list
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
    /// Set up agent cloud credentials (login + approve contexts + default context + configure MCP)
    Init(cli::init::InitArgs),
    /// Authenticate with a cloud provider (opens browser)
    Login(cli::login::LoginArgs),
    /// Switch active context — requires shell eval, use 'exec' for scripts/agents
    #[command(name = "use")]
    Use(cli::use_cmd::UseArgs),
    /// Show current authentication status
    Status(cli::status::StatusArgs),
    /// List available contexts
    #[command(name = "contexts")]
    Contexts(cli::contexts::ContextsArgs),
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
    /// Update glrs-assume to the latest version
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
    // Nudge standalone users toward the npm-hosted package. Non-blocking —
    // prints once per invocation to stderr, never exits or blocks.
    if std::env::var("GLRS_CLI_DISPATCHED")
        .map(|v| v.is_empty())
        .unwrap_or(true)
    {
        eprintln!(
            "\x1b[2m[glrs-assume] migrate to the npm package: npm i -g @glrs-dev/assume\x1b[0m"
        );
    }

    // Initialize tracing with a default filter if RUST_LOG is not set
    // Default: info level for our code, warn for hyper (too verbose at info)
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,hyper=warn"));
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();

    // Migrate a pre-rebrand `gs-assume` config dir forward before loading, so
    // both the load below and `gsa init` see the user's existing providers,
    // contexts, and credentials. Init-only: it's the explicit setup command,
    // and we don't want other commands silently relocating config.
    if matches!(cli.command, Commands::Init(_)) {
        match config::migrate_legacy_config() {
            Ok(Some(legacy)) => {
                eprintln!(
                    "✓ Migrated config from legacy location ({})",
                    legacy.display()
                )
            }
            Ok(None) => {}
            Err(e) => eprintln!("⚠ Could not migrate legacy config: {e}"),
        }
    }

    let cfg = config::load_config()?;
    let registry = build_registry(&cfg)?;

    // Check for updates (skip if running upgrade itself)
    if !matches!(cli.command, Commands::Upgrade(_)) {
        assume::core::update_check::check_for_update();
    }

    // Centralized init gate: until `gsa init` completes, only a small
    // bootstrap/inspection allowlist runs. Everything else refuses, so a
    // freshly-installed-but-unconfigured gsa can't silently start a daemon or
    // serve broken credentials (the failure mode where the daemon is up but no
    // default context exists). The exhaustive match forces every new Commands
    // variant to be classified — the compiler rejects unhandled variants.
    enum InitGate {
        AllowedPreInit,
        RequiresInit,
    }
    let gate = match &cli.command {
        Commands::Init(_)
        | Commands::Upgrade(_)
        | Commands::ShellInit(_)
        | Commands::Status(_)
        | Commands::Config(_) => InitGate::AllowedPreInit,
        Commands::Login(_)
        | Commands::Use(_)
        | Commands::Exec(_)
        | Commands::Sync(_)
        | Commands::Contexts(_)
        | Commands::Serve(_)
        | Commands::Logout(_)
        | Commands::Console(_)
        | Commands::CredentialProcess(_)
        | Commands::Agent(_) => InitGate::RequiresInit,
    };
    if matches!(gate, InitGate::RequiresInit) && !config::is_initialized() {
        anyhow::bail!(
            "glrs-assume isn't set up yet. Run `gsa init` to authenticate, approve agent contexts, and pick a default context."
        );
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
        Commands::Init(_) => cli::init::REQUIREMENT,
        Commands::Login(_) => cli::login::REQUIREMENT,
        Commands::Logout(_) => cli::logout::REQUIREMENT,
        Commands::Status(_) => cli::status::REQUIREMENT,
        Commands::Contexts(_) => cli::contexts::REQUIREMENT,
        Commands::Sync(_) => cli::sync::REQUIREMENT,
        Commands::Config(_) => cli::config_cmd::REQUIREMENT,
        Commands::Console(_) => cli::console::REQUIREMENT,
        Commands::ShellInit(_) => cli::shell_init::REQUIREMENT,
        Commands::Upgrade(_) => cli::upgrade::REQUIREMENT,
    };
    match requirement {
        DaemonRequirement::Daemon => assume::core::daemon::ensure_daemon_running(),
        DaemonRequirement::BackgroundEnsure => assume::core::daemon::spawn_daemon_if_dead(),
        DaemonRequirement::None => {}
    }

    // Inline refresh: if any provider has an expired session but a valid refresh
    // token (and the daemon isn't running to handle it), refresh now so the
    // current command gets fresh tokens instead of failing.
    if !assume::core::daemon::is_daemon_running() {
        let now = chrono::Utc::now();
        for provider_id in registry.ids() {
            if let Ok(Some(tokens)) = assume::core::keychain::load_tokens(&provider_id) {
                if tokens.session_expires_at <= now && tokens.refresh_expires_at > now {
                    if let Some(provider) = registry.get(&provider_id) {
                        match provider.refresh(&tokens).await {
                            Ok(new_tokens) => {
                                let _ =
                                    assume::core::keychain::store_tokens(&provider_id, &new_tokens);
                                tracing::info!(
                                    "Inline refresh succeeded for {provider_id} (daemon not running)"
                                );
                            }
                            Err(e) => {
                                tracing::debug!("Inline refresh failed for {provider_id}: {e}");
                            }
                        }
                    }
                }
            }
        }
    }

    match cli.command {
        Commands::Agent(args) => cli::agent::run(args, &registry, &cfg).await,
        Commands::Config(args) => cli::config_cmd::run(args).await,
        Commands::Init(args) => cli::init::run(args, &registry, &cfg).await,
        Commands::Login(args) => cli::login::run(args, &registry, &cfg).await,
        Commands::Use(args) => cli::use_cmd::run(args, &registry, &cfg).await,
        Commands::Status(args) => cli::status::run(args, &registry, &cfg).await,
        Commands::Contexts(args) => cli::contexts::run(args, &registry, &cfg).await,
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
