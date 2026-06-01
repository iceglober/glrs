use crate::core::config;
use crate::core::daemon::DaemonRequirement;
use crate::core::{fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::tui::multiselect::{self, Item, SelectResult};
use crate::tui::picker::{self, PickerResult};
use anyhow::{anyhow, Result};
use clap::Args;
use std::path::{Path, PathBuf};

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

#[derive(Args, Debug)]
pub struct InitArgs {
    /// Skip interactive login (assume already authenticated)
    #[arg(long)]
    pub skip_login: bool,

    /// Default context to set non-interactively (fuzzy pattern, e.g. "dev",
    /// "prod/admin", "gcp:my-project"). Omit to pick one interactively.
    #[arg(long)]
    pub default_context: Option<String>,
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

    // 3. Choose the default context. Required: it's what the bare credential
    //    endpoint and `gsa exec`/agents resolve to when no context is pinned.
    //    Without it, a running daemon still has nothing to serve.
    if !select_default_context(&args, registry, cfg).await? {
        eprintln!(
            "\nNo default context selected — setup is incomplete. \
             Re-run `gsa init` to finish."
        );
        return Ok(());
    }

    // 4. Pick which agent tools to wire the gsa MCP server into.
    configure_mcp_tools()?;

    // Mark init complete only after every required step succeeded. Until this
    // marker exists, the init gate in main.rs keeps gsa non-functional.
    config::mark_initialized()?;

    eprintln!("\n✓ Done. Restart your agent session to pick up the MCP server.");
    Ok(())
}

/// Select and persist the default (active) context. Returns `Ok(true)` when a
/// context was set, `Ok(false)` when the user cancelled the interactive
/// picker, and `Err` when no contexts are available at all.
async fn select_default_context(
    args: &InitArgs,
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<bool> {
    // Gather contexts across every authenticated provider.
    let mut all = Vec::new();
    for provider_id in registry.ids() {
        all.extend(super::use_cmd::gather_contexts(registry, cfg, &provider_id).await);
    }
    if all.is_empty() {
        return Err(anyhow!(
            "No contexts available to set as a default. Authenticate first with `gsa login`, then re-run `gsa init`."
        ));
    }

    let active_id = crate::core::cache::load_active_context().map(|c| c.id);

    let selected = match &args.default_context {
        Some(pattern) => {
            let matches = fuzzy::match_contexts(pattern, &all);
            match matches.first() {
                Some(m) => m.context.clone(),
                None => return Err(anyhow!("No context matching '{pattern}'")),
            }
        }
        None => {
            eprintln!(
                "\nChoose a default context (used by agents and `gsa exec` when no context is given):\n"
            );
            match picker::run(&all, active_id.as_deref())? {
                PickerResult::Selected(ctx) => ctx,
                PickerResult::Cancelled => return Ok(false),
            }
        }
    };

    crate::core::cache::save_active_context(&selected)?;
    eprintln!(
        "✓ Default context: [{}] {}",
        selected.provider_id, selected.display_name
    );
    Ok(true)
}

// ---- Agent-tool MCP wiring ----

/// A supported agent tool that can host the gsa MCP server.
struct AgentTool {
    id: &'static str,
    label: &'static str,
}

const TOOLS: &[AgentTool] = &[
    AgentTool {
        id: "opencode",
        label: "OpenCode",
    },
    AgentTool {
        id: "claude-code",
        label: "Claude Code",
    },
    AgentTool {
        id: "gemini",
        label: "Gemini CLI",
    },
    AgentTool {
        id: "cursor",
        label: "Cursor",
    },
];

fn configure_mcp_tools() -> Result<()> {
    let items: Vec<Item> = TOOLS
        .iter()
        .map(|t| {
            let detected = is_installed(t.id);
            let detail = match mcp_config_path(t.id) {
                Some(p) if p.exists() => format!("({})", display_home(&p)),
                Some(p) => format!("(will create {})", display_home(&p)),
                None => "(unknown config location)".to_string(),
            };
            Item {
                id: t.id.to_string(),
                label: t.label.to_string(),
                detail: if detected {
                    detail
                } else {
                    format!("(not detected) {detail}")
                },
                // Every tool is selectable; detected ones are pre-checked.
                enabled: true,
                preselected: detected,
            }
        })
        .collect();

    eprintln!("\nSelect which agent tools to configure the gsa MCP server for:\n");
    let selected = match multiselect::run("gsa init — configure MCP", &items)? {
        SelectResult::Confirmed(set) => set,
        SelectResult::Cancelled => {
            eprintln!("\nSkipped MCP setup. You can re-run `gsa init` any time.");
            return Ok(());
        }
    };

    if selected.is_empty() {
        eprintln!("\nNo tools selected — skipping MCP setup.");
        print_manual_instructions();
        return Ok(());
    }

    eprintln!();
    for tool in TOOLS {
        if !selected.contains(tool.id) {
            continue;
        }
        match write_mcp(tool.id) {
            Ok(Outcome::Added(path)) => {
                eprintln!("✓ {}: added gsa MCP to {}", tool.label, display_home(&path))
            }
            Ok(Outcome::AlreadyPresent) => {
                eprintln!("✓ {}: gsa MCP already configured", tool.label)
            }
            Err(e) => eprintln!("⚠ {}: {e}", tool.label),
        }
    }

    Ok(())
}

enum Outcome {
    Added(PathBuf),
    AlreadyPresent,
}

/// True if the tool looks installed: its config file/dir exists, or its CLI is
/// on PATH. Detection only seeds the default selection — the user can override.
fn is_installed(id: &str) -> bool {
    let cfg_present = mcp_config_path(id).map(|p| p.exists()).unwrap_or(false);
    let dir_present = match id {
        "claude-code" => home_join(".claude").map(|p| p.exists()).unwrap_or(false),
        "gemini" => home_join(".gemini").map(|p| p.exists()).unwrap_or(false),
        "cursor" => home_join(".cursor").map(|p| p.exists()).unwrap_or(false),
        _ => false,
    };
    let bin = match id {
        "opencode" => "opencode",
        "claude-code" => "claude",
        "gemini" => "gemini",
        "cursor" => "cursor",
        _ => return cfg_present || dir_present,
    };
    cfg_present || dir_present || binary_on_path(bin)
}

/// The JSON file that holds the tool's MCP server map.
fn mcp_config_path(id: &str) -> Option<PathBuf> {
    match id {
        "opencode" => Some(dirs::config_dir()?.join("opencode/opencode.json")),
        "claude-code" => Some(dirs::home_dir()?.join(".claude.json")),
        "gemini" => Some(dirs::home_dir()?.join(".gemini/settings.json")),
        "cursor" => Some(dirs::home_dir()?.join(".cursor/mcp.json")),
        _ => None,
    }
}

/// The `(top-level key, gsa server entry)` for a tool's MCP config.
///
/// OpenCode uses a `mcp` map with array-form `command` plus `type`/`enabled`.
/// Claude Code, Gemini CLI, and Cursor all use a `mcpServers` map with the
/// standard stdio `command` + `args` shape.
fn mcp_entry_for(id: &str) -> (&'static str, serde_json::Value) {
    match id {
        "opencode" => (
            "mcp",
            serde_json::json!({
                "type": "local",
                "command": ["gsa", "agent", "mcp"],
                "enabled": true,
            }),
        ),
        _ => (
            "mcpServers",
            serde_json::json!({ "command": "gsa", "args": ["agent", "mcp"] }),
        ),
    }
}

fn write_mcp(id: &str) -> Result<Outcome> {
    let path = mcp_config_path(id).ok_or_else(|| anyhow!("unknown config location"))?;
    let (top_key, entry) = mcp_entry_for(id);
    upsert_mcp_entry(&path, top_key, "gsa", entry)
}

/// Insert `name` into `top_key` of the JSON file at `path`, creating the file
/// (and parent dirs) if absent. Leaves an existing `name` entry untouched.
fn upsert_mcp_entry(
    path: &Path,
    top_key: &str,
    name: &str,
    entry: serde_json::Value,
) -> Result<Outcome> {
    let mut config: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        if content.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&content)
                .map_err(|e| anyhow!("{} has invalid JSON: {e}", path.display()))?
        }
    } else {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        serde_json::json!({})
    };

    let obj = config
        .as_object_mut()
        .ok_or_else(|| anyhow!("{} is not a JSON object", path.display()))?;
    let bucket = obj.entry(top_key).or_insert_with(|| serde_json::json!({}));
    let bucket = bucket
        .as_object_mut()
        .ok_or_else(|| anyhow!("`{top_key}` is not an object in {}", path.display()))?;

    if bucket.contains_key(name) {
        return Ok(Outcome::AlreadyPresent);
    }
    bucket.insert(name.to_string(), entry);

    let formatted = serde_json::to_string_pretty(&config)?;
    std::fs::write(path, formatted + "\n")?;
    Ok(Outcome::Added(path.to_path_buf()))
}

fn home_join(rel: &str) -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(rel))
}

/// Render a path with the home dir collapsed to `~` for friendlier output.
fn display_home(path: &Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(rest) = path.strip_prefix(&home) {
            return format!("~/{}", rest.display());
        }
    }
    path.display().to_string()
}

/// Whether `bin` is found on any PATH entry.
fn binary_on_path(bin: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|dir| dir.join(bin).is_file())
}

fn print_manual_instructions() {
    eprintln!("\nAdd the gsa MCP server manually:\n");
    eprintln!("OpenCode  (~/.config/opencode/opencode.json):");
    eprintln!(
        r#"  "mcp": {{ "gsa": {{ "type": "local", "command": ["gsa", "agent", "mcp"], "enabled": true }} }}"#
    );
    eprintln!("\nClaude Code (~/.claude.json), Gemini CLI (~/.gemini/settings.json), Cursor (~/.cursor/mcp.json):");
    eprintln!(r#"  "mcpServers": {{ "gsa": {{ "command": "gsa", "args": ["agent", "mcp"] }} }}"#);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_uses_array_command_and_type_enabled() {
        let (key, entry) = mcp_entry_for("opencode");
        assert_eq!(key, "mcp");
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["enabled"], true);
        assert_eq!(entry["command"], serde_json::json!(["gsa", "agent", "mcp"]));
        assert!(entry.get("args").is_none());
    }

    #[test]
    fn stdio_tools_use_mcpservers_command_args() {
        for id in ["claude-code", "gemini", "cursor"] {
            let (key, entry) = mcp_entry_for(id);
            assert_eq!(key, "mcpServers", "tool {id}");
            assert_eq!(entry["command"], "gsa", "tool {id}");
            assert_eq!(
                entry["args"],
                serde_json::json!(["agent", "mcp"]),
                "tool {id}"
            );
            assert!(entry.get("type").is_none(), "tool {id}");
        }
    }

    #[test]
    fn every_tool_has_a_config_path() {
        for t in TOOLS {
            assert!(mcp_config_path(t.id).is_some(), "no path for {}", t.id);
        }
    }

    #[test]
    fn upsert_creates_missing_file_then_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("gsa-init-test-{}", std::process::id()));
        let path = dir.join("nested/opencode.json");
        let _ = std::fs::remove_dir_all(&dir);

        // First write creates the file + parent dirs.
        let (key, entry) = mcp_entry_for("opencode");
        match upsert_mcp_entry(&path, key, "gsa", entry.clone()).unwrap() {
            Outcome::Added(p) => assert_eq!(p, path),
            Outcome::AlreadyPresent => panic!("expected Added"),
        }
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["mcp"]["gsa"]["type"], "local");

        // Second write is a no-op (already present).
        match upsert_mcp_entry(&path, key, "gsa", entry).unwrap() {
            Outcome::AlreadyPresent => {}
            Outcome::Added(_) => panic!("expected AlreadyPresent"),
        }

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn upsert_preserves_existing_keys() {
        let dir = std::env::temp_dir().join(format!("gsa-init-test2-{}", std::process::id()));
        let path = dir.join("opencode.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            &path,
            r#"{"theme":"dark","mcp":{"other":{"enabled":true}}}"#,
        )
        .unwrap();

        let (key, entry) = mcp_entry_for("opencode");
        upsert_mcp_entry(&path, key, "gsa", entry).unwrap();

        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcp"]["other"]["enabled"], true);
        assert_eq!(v["mcp"]["gsa"]["type"], "local");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
