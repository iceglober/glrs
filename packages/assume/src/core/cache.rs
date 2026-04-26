use crate::plugin::Context;
use anyhow::{Context as _, Result};
use std::path::PathBuf;

/// Cache directory: config_dir/cache/
fn cache_dir() -> PathBuf {
    super::config::config_dir().join("cache")
}

fn contexts_path(provider_id: &str) -> PathBuf {
    cache_dir().join(format!("{provider_id}-contexts.json"))
}

fn active_path() -> PathBuf {
    super::config::config_dir().join("active.json")
}

/// Save discovered contexts to disk cache.
pub fn save_contexts(provider_id: &str, contexts: &[Context]) -> Result<()> {
    let dir = cache_dir();
    std::fs::create_dir_all(&dir)?;
    let path = contexts_path(provider_id);
    let json = serde_json::to_string(contexts)?;
    std::fs::write(&path, json)
        .with_context(|| format!("Failed to write context cache for {provider_id}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Load cached contexts. Returns None if cache doesn't exist.
pub fn load_contexts(provider_id: &str) -> Option<Vec<Context>> {
    let path = contexts_path(provider_id);
    let json = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&json).ok()
}

/// Save the currently active context to disk.
pub fn save_active_context(context: &Context) -> Result<()> {
    let path = active_path();
    let json = serde_json::to_string(context)?;
    std::fs::write(&path, json).with_context(|| "Failed to write active context")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Load the currently active context from disk.
pub fn load_active_context() -> Option<Context> {
    let path = active_path();
    let json = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&json).ok()
}

/// Clear the active context.
pub fn clear_active_context() {
    let path = active_path();
    let _ = std::fs::remove_file(path);
}

fn agent_allowed_path() -> PathBuf {
    super::config::config_dir().join("agent-allowed.json")
}

/// Load the set of context IDs that are approved for agent access.
pub fn load_agent_allowed() -> std::collections::HashSet<String> {
    let path = agent_allowed_path();
    let json = match std::fs::read_to_string(&path) {
        Ok(j) => j,
        Err(_) => return std::collections::HashSet::new(),
    };
    let ids: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
    ids.into_iter().collect()
}

/// Save the set of context IDs approved for agent access.
pub fn save_agent_allowed(ids: &std::collections::HashSet<String>) -> Result<()> {
    let path = agent_allowed_path();
    let sorted: Vec<&String> = {
        let mut v: Vec<&String> = ids.iter().collect();
        v.sort();
        v
    };
    let json = serde_json::to_string_pretty(&sorted)?;
    std::fs::write(&path, json).with_context(|| "Failed to write agent-allowed.json")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Clear all agent access permissions.
pub fn clear_agent_allowed() {
    let path = agent_allowed_path();
    let _ = std::fs::remove_file(path);
}
