use crate::core::{audit, config, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;
use std::io::{self, BufRead, Write};

#[derive(Args, Debug)]
pub struct LoginArgs {
    /// Provider to authenticate with (e.g., "aws", "gcp")
    pub provider: Option<String>,
}

/// Escape a string for safe interpolation inside double-quoted shell values.
fn shell_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`")
        .replace('!', "\\!")
}

/// Output export lines to set the prompt to [provider:no-profile].
/// Used when login completes but no specific context is selected.
fn print_provider_prompt(provider_id: &str) {
    let label = format!("{provider_id}:no-profile");
    let color = if provider_id == "gcp" {
        "blue"
    } else {
        "green"
    };
    println!("export GS_ASSUME_CONTEXT=\"{}\"", shell_escape(&label));
    println!("export GS_ASSUME_CONTEXT_COLOR=\"{}\"", color);
    println!("export GS_ASSUME_CONTEXT_ID=\"\"");
    println!(
        "export GS_ASSUME_CONTEXT_PROVIDER=\"{}\"",
        shell_escape(provider_id)
    );
}

/// Prompt the user for input with an optional default value.
fn prompt(message: &str, default: Option<&str>) -> Result<String> {
    let suffix = match default {
        Some(d) => format!(" [{d}]: "),
        None => ": ".to_string(),
    };
    eprint!("{message}{suffix}");
    io::stderr().flush()?;

    let mut input = String::new();
    io::stdin().lock().read_line(&mut input)?;
    let trimmed = input.trim().to_string();

    if trimmed.is_empty() {
        Ok(default.unwrap_or("").to_string())
    } else {
        Ok(trimmed)
    }
}

/// Check if AWS provider needs interactive setup, and if so, prompt and save config.
fn ensure_aws_configured(provider_config: &mut crate::plugin::ProviderConfig) -> Result<bool> {
    let has_start_url = provider_config
        .extra
        .get("start_url")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());

    if has_start_url {
        return Ok(false); // Already configured
    }

    eprintln!("AWS Identity Center not configured. Let's set it up.\n");

    let start_url = prompt(
        "Enter your SSO start URL (e.g., https://myorg.awsapps.com/start)",
        None,
    )?;
    if start_url.is_empty() {
        bail!("SSO start URL is required");
    }

    let region = prompt("Enter your SSO region", Some("us-east-1"))?;

    // Update in-memory config
    provider_config.extra.insert(
        "start_url".to_string(),
        toml::Value::String(start_url.clone()),
    );
    provider_config
        .extra
        .insert("region".to_string(), toml::Value::String(region.clone()));
    provider_config.enabled = true;

    // Save to config file
    let path = config::config_path();
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)?;

    let mut doc: toml::Table = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        content.parse::<toml::Table>()?
    } else {
        toml::Table::new()
    };

    // Ensure providers.aws table exists
    let providers = doc
        .entry("providers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .unwrap();

    let aws = providers
        .entry("aws".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .unwrap();

    aws.insert("enabled".to_string(), toml::Value::Boolean(true));
    aws.insert("start_url".to_string(), toml::Value::String(start_url));
    aws.insert("region".to_string(), toml::Value::String(region));

    let content = toml::to_string_pretty(&toml::Value::Table(doc))?;
    std::fs::write(&path, content)?;

    eprintln!("\nConfig saved to {}", path.display());
    eprintln!();

    Ok(true) // Was configured
}

/// Check if GCP provider needs interactive setup, and if so, prompt and save config.
fn ensure_gcp_configured(provider_config: &mut crate::plugin::ProviderConfig) -> Result<bool> {
    let has_client_id = provider_config
        .extra
        .get("client_id")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());

    if has_client_id {
        return Ok(false); // Already configured
    }

    eprintln!("Google Cloud not configured. Let's set it up.\n");
    eprintln!(
        "You need a Google OAuth 2.0 client ID configured for 'TVs and Limited Input devices'."
    );
    eprintln!("Create one at: https://console.cloud.google.com/apis/credentials\n");

    let client_id = prompt("Enter your OAuth client ID", None)?;
    if client_id.is_empty() {
        bail!("OAuth client ID is required");
    }

    let client_secret = prompt("Enter your OAuth client secret", None)?;
    if client_secret.is_empty() {
        bail!("OAuth client secret is required");
    }

    let region = prompt("Enter your default GCP region", Some("us-central1"))?;

    // Update in-memory config
    provider_config.extra.insert(
        "client_id".to_string(),
        toml::Value::String(client_id.clone()),
    );
    provider_config.extra.insert(
        "client_secret".to_string(),
        toml::Value::String(client_secret.clone()),
    );
    provider_config.default_region = Some(region.clone());
    provider_config.enabled = true;

    // Save to config file
    let path = config::config_path();
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)?;

    let mut doc: toml::Table = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        content.parse::<toml::Table>()?
    } else {
        toml::Table::new()
    };

    let providers = doc
        .entry("providers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .unwrap();

    let gcp = providers
        .entry("gcp".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .unwrap();

    gcp.insert("enabled".to_string(), toml::Value::Boolean(true));
    gcp.insert("client_id".to_string(), toml::Value::String(client_id));
    gcp.insert(
        "client_secret".to_string(),
        toml::Value::String(client_secret),
    );
    gcp.insert("default_region".to_string(), toml::Value::String(region));

    let content = toml::to_string_pretty(&toml::Value::Table(doc))?;
    std::fs::write(&path, content)?;

    eprintln!("\nConfig saved to {}", path.display());
    eprintln!();

    Ok(true)
}

pub async fn run(args: LoginArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    let provider_id = match args.provider {
        Some(ref id) => id.clone(),
        None => {
            let ids = registry.ids();
            if ids.len() == 1 {
                ids[0].clone()
            } else {
                eprintln!("Available providers: {}", ids.join(", "));
                bail!("Specify a provider: gs-assume login <provider>");
            }
        }
    };

    let provider = registry
        .get(&provider_id)
        .ok_or_else(|| anyhow::anyhow!("Unknown provider: {provider_id}"))?;

    let mut provider_config = cfg.providers.get(&provider_id).cloned().unwrap_or_default();

    // Interactive setup if provider not configured
    if provider_id == "aws" {
        ensure_aws_configured(&mut provider_config)?;
    } else if provider_id == "gcp" {
        ensure_gcp_configured(&mut provider_config)?;
    }

    eprintln!("Logging in to {}...", provider.display_name());

    let tokens = provider
        .login(&provider_config)
        .await
        .map_err(|e| anyhow::anyhow!("{} login failed: {e}", provider.display_name()))?;

    // Store tokens (encrypted at rest)
    keychain::store_tokens(&provider_id, &tokens)?;

    // Discover available contexts
    eprintln!("Discovering available contexts...");
    match provider.list_contexts(&tokens).await {
        Ok(mut contexts) => {
            // Auto-tag dangerous contexts
            if provider_id == "aws" {
                crate::providers::aws::contexts::auto_tag_dangerous(&mut contexts);
            } else if provider_id == "gcp" {
                crate::providers::gcp::contexts::auto_tag_dangerous(&mut contexts);
            }

            eprintln!(
                "Authenticated as {} — {} context(s) available",
                provider.display_name(),
                contexts.len()
            );
            for ctx in &contexts {
                let alias = ctx
                    .metadata
                    .get("alias")
                    .map(|a| format!(" ({})", a))
                    .unwrap_or_default();
                eprintln!("  {} {}{}", ctx.display_name, ctx.region, alias);
            }

            // Cache contexts for fast offline access
            if let Err(e) = crate::core::cache::save_contexts(&provider_id, &contexts) {
                tracing::warn!("Failed to cache contexts: {e}");
            }

            // Set prompt: auto-select if single context, otherwise [provider:no-profile]
            if contexts.len() == 1 {
                let selected = &contexts[0];
                eprintln!(
                    "Auto-selected: {} ({})",
                    selected.display_name, selected.region
                );
                super::use_cmd::print_context_exports(selected, cfg);
                if let Err(e) = crate::core::cache::save_active_context(selected) {
                    tracing::warn!("Failed to save active context: {e}");
                }
            } else {
                // Multiple contexts — set provider-only prompt
                print_provider_prompt(&provider_id);
                eprintln!("Run: gsa use {provider_id} <profile> to select a context");
            }
        }
        Err(e) => {
            eprintln!("Warning: Failed to list contexts: {e}");
            eprintln!("You can try: gs-assume sync {provider_id}");
            // Still set the provider prompt even without contexts
            print_provider_prompt(&provider_id);
        }
    }

    let expires = tokens.session_expires_at.format("%Y-%m-%d %H:%M UTC");
    eprintln!("Session valid until {expires}");

    // Restart daemon so it picks up the fresh tokens from vault
    crate::core::daemon::restart_daemon();

    audit::log_event(
        audit::AuditEvent::Login,
        &provider_id,
        provider.display_name(),
    );

    Ok(())
}
