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
        }
        Err(e) => {
            eprintln!("Warning: Failed to list contexts: {e}");
            eprintln!("You can try: gs-assume sync {provider_id}");
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
