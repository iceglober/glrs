use crate::plugin::Context;
use anyhow::{Context as _, Result};
use std::path::{Path, PathBuf};

/// Cache directory: config_dir/cache/
fn cache_dir() -> PathBuf {
    super::config::config_dir().join("cache")
}

fn contexts_path(provider_id: &str) -> PathBuf {
    cache_dir().join(format!("{provider_id}-contexts.json"))
}

// The default-context store is parameterized by config-dir so tests can inject a
// temp directory without mutating the process-global GLRS_ASSUME_CONFIG_DIR (the
// public wrappers below pass `config::config_dir()`).

/// Legacy single active-context file, kept only for one-time migration into the
/// per-provider default store. New code never writes this path.
fn legacy_active_path_in(base: &Path) -> PathBuf {
    base.join("active.json")
}

fn default_path_in(base: &Path, provider_id: &str) -> PathBuf {
    base.join("defaults").join(format!("{provider_id}.json"))
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

/// Save a provider's default (machine-global ambient) context to disk. The
/// provider is taken from `context.provider_id`, so each provider keeps its own
/// default and they never clobber each other.
pub fn save_default(context: &Context) -> Result<()> {
    save_default_in(&super::config::config_dir(), context)
}

fn save_default_in(base: &Path, context: &Context) -> Result<()> {
    let path = default_path_in(base, &context.provider_id);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string(context)?;
    std::fs::write(&path, json).with_context(|| {
        format!(
            "Failed to write default context for {}",
            context.provider_id
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Load a single provider's default context. None if that provider has no default.
pub fn load_default(provider_id: &str) -> Option<Context> {
    load_default_in(&super::config::config_dir(), provider_id)
}

fn load_default_in(base: &Path, provider_id: &str) -> Option<Context> {
    let json = std::fs::read_to_string(default_path_in(base, provider_id)).ok()?;
    serde_json::from_str(&json).ok()
}

/// Load every provider's default context. Empty when nothing is configured.
pub fn load_all_defaults() -> Vec<Context> {
    load_all_defaults_in(&super::config::config_dir())
}

fn load_all_defaults_in(base: &Path) -> Vec<Context> {
    let dir = base.join("defaults");
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut defaults = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(ctx) = serde_json::from_str::<Context>(&json) {
                defaults.push(ctx);
            }
        }
    }
    // Stable order across consumers (prompt, exec, status) regardless of the
    // filesystem's directory-read order — e.g. aws before gcp.
    defaults.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));
    defaults
}

/// Clear a single provider's default context (e.g. on logout of that provider).
pub fn clear_default(provider_id: &str) {
    let _ = std::fs::remove_file(default_path_in(&super::config::config_dir(), provider_id));
}

/// One-time migration: fold a pre-existing single `active.json` into the
/// per-provider default store, then remove it. Safe to call on every startup —
/// it's a no-op once `active.json` is gone. Never overwrites an existing
/// per-provider default (a newer write wins).
pub fn migrate_legacy_active_context() {
    migrate_legacy_active_context_in(&super::config::config_dir());
}

fn migrate_legacy_active_context_in(base: &Path) {
    let legacy = legacy_active_path_in(base);
    let json = match std::fs::read_to_string(&legacy) {
        Ok(j) => j,
        Err(_) => return, // nothing to migrate
    };
    if let Ok(ctx) = serde_json::from_str::<Context>(&json) {
        if load_default_in(base, &ctx.provider_id).is_none() {
            let _ = save_default_in(base, &ctx);
        }
    }
    let _ = std::fs::remove_file(&legacy);
}

fn needs_login_path_in(base: &Path, provider_id: &str) -> PathBuf {
    base.join("needs-login").join(provider_id)
}

/// Flag that a provider needs an interactive re-login because its refresh
/// credential was rejected — AWS SSO session ended, or GCP reauth
/// (`invalid_rapt`). GCP stamps a 10-year refresh expiry, so a timestamp check
/// can't catch this; the daemon sets this marker when a refresh actually fails,
/// and it's cleared whenever fresh tokens are stored.
pub fn mark_needs_login(provider_id: &str) {
    mark_needs_login_in(&super::config::config_dir(), provider_id)
}

fn mark_needs_login_in(base: &Path, provider_id: &str) {
    let path = needs_login_path_in(base, provider_id);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, "");
}

/// Clear the needs-login marker (called when fresh tokens are stored).
pub fn clear_needs_login(provider_id: &str) {
    clear_needs_login_in(&super::config::config_dir(), provider_id)
}

fn clear_needs_login_in(base: &Path, provider_id: &str) {
    let _ = std::fs::remove_file(needs_login_path_in(base, provider_id));
}

/// Whether a provider is flagged as needing interactive re-login.
pub fn needs_login(provider_id: &str) -> bool {
    needs_login_in(&super::config::config_dir(), provider_id)
}

fn needs_login_in(base: &Path, provider_id: &str) -> bool {
    needs_login_path_in(base, provider_id).exists()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(provider: &str, id: &str, name: &str) -> Context {
        Context {
            provider_id: provider.into(),
            id: id.into(),
            display_name: name.into(),
            searchable_fields: vec![],
            tags: vec![],
            metadata: Default::default(),
            region: "us-east-1".into(),
        }
    }

    // Use the *_in cores with a temp dir so these tests never touch the
    // process-global GLRS_ASSUME_CONFIG_DIR — no cross-test env race.
    fn tmp() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }

    #[test]
    fn defaults_are_per_provider_and_isolated() {
        let d = tmp();
        let base = d.path();
        save_default_in(base, &ctx("aws", "a1", "dev")).unwrap();
        save_default_in(base, &ctx("gcp", "g1", "my-proj")).unwrap();

        assert_eq!(load_default_in(base, "aws").unwrap().id, "a1");
        assert_eq!(load_default_in(base, "gcp").unwrap().id, "g1");

        // Overwriting one provider leaves the other untouched.
        save_default_in(base, &ctx("aws", "a2", "prod")).unwrap();
        assert_eq!(load_default_in(base, "aws").unwrap().id, "a2");
        assert_eq!(load_default_in(base, "gcp").unwrap().id, "g1");
    }

    #[test]
    fn load_all_defaults_is_sorted_by_provider() {
        let d = tmp();
        let base = d.path();
        save_default_in(base, &ctx("gcp", "g1", "my-proj")).unwrap();
        save_default_in(base, &ctx("aws", "a1", "dev")).unwrap();
        let ids: Vec<String> = load_all_defaults_in(base)
            .into_iter()
            .map(|c| c.provider_id)
            .collect();
        assert_eq!(ids, vec!["aws".to_string(), "gcp".to_string()]);
    }

    #[test]
    fn clear_default_only_removes_that_provider() {
        let d = tmp();
        let base = d.path();
        save_default_in(base, &ctx("aws", "a1", "dev")).unwrap();
        save_default_in(base, &ctx("gcp", "g1", "my-proj")).unwrap();
        let _ = std::fs::remove_file(default_path_in(base, "aws"));
        assert!(load_default_in(base, "aws").is_none());
        assert!(load_default_in(base, "gcp").is_some());
    }

    #[test]
    fn needs_login_marker_set_clear_per_provider() {
        let d = tmp();
        let base = d.path();
        assert!(!needs_login_in(base, "gcp"));
        mark_needs_login_in(base, "gcp");
        assert!(needs_login_in(base, "gcp"));
        // Marking one provider doesn't flag another.
        assert!(!needs_login_in(base, "aws"));
        clear_needs_login_in(base, "gcp");
        assert!(!needs_login_in(base, "gcp"));
        // Clearing an unset marker is a no-op, not an error.
        clear_needs_login_in(base, "aws");
    }

    #[test]
    fn migration_folds_active_json_into_defaults_then_removes_it() {
        let d = tmp();
        let base = d.path();
        let legacy = legacy_active_path_in(base);
        std::fs::write(
            &legacy,
            serde_json::to_string(&ctx("aws", "a1", "dev")).unwrap(),
        )
        .unwrap();

        migrate_legacy_active_context_in(base);

        assert_eq!(load_default_in(base, "aws").unwrap().id, "a1");
        assert!(
            !legacy.exists(),
            "active.json should be removed after migration"
        );

        // Idempotent: a second call is a clean no-op.
        migrate_legacy_active_context_in(base);
        assert_eq!(load_default_in(base, "aws").unwrap().id, "a1");
    }

    #[test]
    fn migration_does_not_clobber_an_existing_default() {
        let d = tmp();
        let base = d.path();
        save_default_in(base, &ctx("aws", "new", "current")).unwrap();
        std::fs::write(
            legacy_active_path_in(base),
            serde_json::to_string(&ctx("aws", "old", "stale")).unwrap(),
        )
        .unwrap();

        migrate_legacy_active_context_in(base);

        // The existing per-provider default wins over the legacy file.
        assert_eq!(load_default_in(base, "aws").unwrap().id, "new");
    }
}
