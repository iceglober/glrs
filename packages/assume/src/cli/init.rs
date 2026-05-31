use crate::core::config;
use crate::core::daemon::DaemonRequirement;
use crate::core::keychain;
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;
use std::path::PathBuf;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

#[derive(Args, Debug)]
pub struct InitArgs {
    /// Skip interactive login (assume already authenticated)
    #[arg(long)]
    pub skip_login: bool,
}

pub async fn run(args: InitArgs, registry: &PluginRegistry, cfg: &config::Config) -> Result<()> {
    eprintln!("glrs-assume init — setting up agent cloud credentials\n");

    // 1. Check auth status
    let has_session = registry.ids().iter().any(|id| {
        keychain::load_tokens(id)
            .ok()
            .flatten()
            .map(|t| t.refresh_expires_at > chrono::Utc::now())
            .unwrap_or(false)
    });

    if !has_session && !args.skip_login {
        eprintln!("No active session. Starting login...\n");
        let login_args = super::login::LoginArgs { provider: None };
        super::login::run(login_args, registry, cfg).await?;
        eprintln!();
    } else if has_session {
        eprintln!("✓ Authenticated");
    }

    // 2. Agent allow (interactive)
    eprintln!("\nSelect which contexts agents can access:\n");
    let allow_args = super::agent::AgentArgs {
        command: super::agent::AgentCommands::Allow(super::agent::AllowArgs {
            clear: false,
            list: false,
        }),
    };
    super::agent::run(allow_args, registry, cfg).await?;

    // 3. Detect agent tool and write MCP config
    let agent_tool = detect_agent_tool();
    match agent_tool {
        AgentTool::OpenCode => write_opencode_mcp()?,
        AgentTool::ClaudeCode => write_claude_code_mcp()?,
        AgentTool::Both => {
            write_opencode_mcp()?;
            write_claude_code_mcp()?;
        }
        AgentTool::Unknown => {
            eprintln!("\nCouldn't detect your agent tool. Add the MCP server manually:\n");
            print_manual_instructions();
        }
    }

    eprintln!("\n✓ Done. Restart your agent session to pick up the MCP server.");
    Ok(())
}

enum AgentTool {
    OpenCode,
    ClaudeCode,
    Both,
    Unknown,
}

fn detect_agent_tool() -> AgentTool {
    let has_opencode = find_opencode_config().is_some();
    let has_claude = find_claude_code_config().is_some();

    match (has_opencode, has_claude) {
        (true, true) => AgentTool::Both,
        (true, false) => AgentTool::OpenCode,
        (false, true) => AgentTool::ClaudeCode,
        (false, false) => AgentTool::Unknown,
    }
}

fn find_opencode_config() -> Option<PathBuf> {
    let path = dirs::config_dir()?.join("opencode/opencode.json");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn find_claude_code_config() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let path = home.join(".claude/settings.json");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn write_opencode_mcp() -> Result<()> {
    let path = match find_opencode_config() {
        Some(p) => p,
        None => bail!("opencode.json not found"),
    };

    let content = std::fs::read_to_string(&path)?;
    let mut config: serde_json::Value = serde_json::from_str(&content)?;

    let mcp = config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("opencode.json is not an object"))?
        .entry("mcp")
        .or_insert_with(|| serde_json::json!({}));

    if mcp.get("gsa").is_some() {
        eprintln!("✓ OpenCode MCP already configured");
        return Ok(());
    }

    mcp.as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("mcp is not an object"))?
        .insert(
            "gsa".to_string(),
            serde_json::json!({
                "command": "gsa",
                "args": ["agent", "mcp"]
            }),
        );

    let formatted = serde_json::to_string_pretty(&config)?;
    std::fs::write(&path, formatted + "\n")?;
    eprintln!("✓ Added gsa MCP to {}", path.display());
    Ok(())
}

fn write_claude_code_mcp() -> Result<()> {
    let path = match find_claude_code_config() {
        Some(p) => p,
        None => bail!("Claude Code settings.json not found"),
    };

    let content = std::fs::read_to_string(&path)?;
    let mut config: serde_json::Value = serde_json::from_str(&content)?;

    let mcp = config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("settings.json is not an object"))?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    if mcp.get("gsa").is_some() {
        eprintln!("✓ Claude Code MCP already configured");
        return Ok(());
    }

    mcp.as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("mcpServers is not an object"))?
        .insert(
            "gsa".to_string(),
            serde_json::json!({
                "command": "gsa",
                "args": ["agent", "mcp"]
            }),
        );

    let formatted = serde_json::to_string_pretty(&config)?;
    std::fs::write(&path, formatted + "\n")?;
    eprintln!("✓ Added gsa MCP to {}", path.display());
    Ok(())
}

fn print_manual_instructions() {
    eprintln!("For Claude Code (~/.claude/settings.json):");
    eprintln!(r#"  {{"mcpServers": {{"gsa": {{"command": "gsa", "args": ["agent", "mcp"]}}}}}}"#);
    eprintln!();
    eprintln!("For OpenCode (opencode.json):");
    eprintln!(r#"  {{"mcp": {{"gsa": {{"command": "gsa", "args": ["agent", "mcp"]}}}}}}"#);
}
