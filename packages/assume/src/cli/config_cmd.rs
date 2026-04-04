use crate::core::config;
use anyhow::{bail, Result};
use clap::{Args, Subcommand};
use std::fs;

#[derive(Args, Debug)]
pub struct ConfigArgs {
    #[command(subcommand)]
    pub command: ConfigCommand,
}

#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Set a configuration value (dot notation: providers.aws.start_url)
    Set {
        /// Config key in dot notation
        key: String,
        /// Value to set
        value: String,
    },
    /// Get a configuration value
    Get {
        /// Config key in dot notation
        key: String,
    },
    /// Show the full configuration file
    Show,
    /// Print the config file path
    Path,
}

pub async fn run(args: ConfigArgs) -> Result<()> {
    match args.command {
        ConfigCommand::Path => {
            println!("{}", config::config_path().display());
        }
        ConfigCommand::Show => {
            let path = config::config_path();
            if path.exists() {
                let content = fs::read_to_string(&path)?;
                println!("{content}");
            } else {
                eprintln!("No config file found at {}", path.display());
                eprintln!("Create one with: gs-assume config set providers.aws.start_url <url>");
            }
        }
        ConfigCommand::Get { key } => {
            let cfg = config::load_config()?;
            let toml_val = toml::Value::try_from(&cfg)?;
            match resolve_key(&toml_val, &key) {
                Some(v) => println!("{v}"),
                None => bail!("Key not found: {key}"),
            }
        }
        ConfigCommand::Set { key, value } => {
            let path = config::config_path();
            let dir = path.parent().unwrap();
            fs::create_dir_all(dir)?;

            // Load existing config as a toml table, or start fresh
            let mut doc: toml::Table = if path.exists() {
                let content = fs::read_to_string(&path)?;
                content.parse::<toml::Table>()?
            } else {
                toml::Table::new()
            };

            // Parse dot-separated key and set the value
            set_nested_key(&mut doc, &key, &value)?;

            // Write back
            let content = toml::to_string_pretty(&toml::Value::Table(doc))?;
            fs::write(&path, content)?;
            eprintln!("Set {key} = {value}");
            eprintln!("Config saved to {}", path.display());
        }
    }
    Ok(())
}

fn resolve_key<'a>(val: &'a toml::Value, key: &str) -> Option<&'a toml::Value> {
    let parts: Vec<&str> = key.split('.').collect();
    let mut current = val;
    for part in parts {
        current = current.get(part)?;
    }
    Some(current)
}

fn set_nested_key(table: &mut toml::Table, key: &str, value: &str) -> Result<()> {
    let parts: Vec<&str> = key.split('.').collect();
    if parts.is_empty() {
        bail!("Empty key");
    }

    let mut current = table;
    for part in &parts[..parts.len() - 1] {
        current = current
            .entry(part.to_string())
            .or_insert_with(|| toml::Value::Table(toml::Table::new()))
            .as_table_mut()
            .ok_or_else(|| anyhow::anyhow!("Key component '{part}' is not a table"))?;
    }

    let leaf = parts.last().unwrap();

    // Try to parse as bool, integer, or fall back to string
    let toml_value = if value == "true" {
        toml::Value::Boolean(true)
    } else if value == "false" {
        toml::Value::Boolean(false)
    } else if let Ok(n) = value.parse::<i64>() {
        toml::Value::Integer(n)
    } else {
        toml::Value::String(value.to_string())
    };

    current.insert(leaf.to_string(), toml_value);
    Ok(())
}
