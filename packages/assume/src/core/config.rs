use crate::plugin::ProviderConfig;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Top-level configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub daemon: DaemonConfig,
    #[serde(default)]
    pub prompt: PromptConfig,
    #[serde(default)]
    pub log: LogConfig,
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default = "default_true")]
    pub notification: bool,
    #[serde(default = "default_tick_interval")]
    pub tick_interval_seconds: u64,
    #[serde(default = "default_refresh_buffer")]
    pub refresh_buffer_minutes: u64,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            notification: true,
            tick_interval_seconds: 60,
            refresh_buffer_minutes: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptConfig {
    #[serde(default = "default_prompt_format")]
    pub format: String,
    /// Where the glrs tags sit relative to your existing prompt:
    /// `"above"` (default) puts them on their own line above it (two-line);
    /// `"inline"` prepends them on the same line.
    #[serde(default = "default_prompt_layout")]
    pub layout: String,
}

impl Default for PromptConfig {
    fn default() -> Self {
        Self {
            format: "[{provider}:{alias}]".to_string(),
            layout: default_prompt_layout(),
        }
    }
}

fn default_prompt_layout() -> String {
    "above".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_log_path")]
    pub path: String,
    #[serde(default = "default_retention_days")]
    pub retention_days: u64,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            path: default_log_path(),
            retention_days: 90,
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_tick_interval() -> u64 {
    60
}
fn default_refresh_buffer() -> u64 {
    5
}
fn default_prompt_format() -> String {
    "[{provider}:{alias}]".to_string()
}
fn default_log_path() -> String {
    "~/.config/glrs-assume/audit.log".to_string()
}
fn default_retention_days() -> u64 {
    90
}

/// Config directory: $GLRS_ASSUME_CONFIG_DIR or ~/.config/glrs-assume/
pub fn config_dir() -> PathBuf {
    if let Ok(p) = std::env::var("GLRS_ASSUME_CONFIG_DIR") {
        return PathBuf::from(p);
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "~".into())))
        .join("glrs-assume")
}

/// Config file path: $GLRS_ASSUME_CONFIG or ~/.config/glrs-assume/config.toml
pub fn config_path() -> PathBuf {
    if let Ok(p) = std::env::var("GLRS_ASSUME_CONFIG") {
        return PathBuf::from(p);
    }
    config_dir().join("config.toml")
}

/// Daemon socket path
pub fn socket_path() -> PathBuf {
    config_dir().join("daemon.sock")
}

/// PID file path
pub fn pid_path() -> PathBuf {
    config_dir().join("daemon.pid")
}

/// File recording the version of the currently-running daemon. The CLI compares
/// it against its own version to detect a daemon left stale by an auto-upgrade.
pub fn daemon_version_path() -> PathBuf {
    config_dir().join("daemon.version")
}

/// Audit log path (resolved from config)
#[allow(dead_code)]
pub fn resolve_log_path(configured: &str) -> PathBuf {
    if configured.starts_with("~/") {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join(configured.strip_prefix("~/").unwrap())
    } else {
        PathBuf::from(configured)
    }
}

/// Load config from disk, merging user config with optional team config.
/// User config wins on conflict.
pub fn load_config() -> Result<Config> {
    let path = config_path();
    let mut config = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read config from {}", path.display()))?;
        toml::from_str::<Config>(&content)
            .with_context(|| format!("Failed to parse config from {}", path.display()))?
    } else {
        Config::default()
    };

    // Try to find and merge team config
    if let Some(team_config) = find_and_load_team_config()? {
        merge_team_config(&mut config, &team_config);
    }

    Ok(config)
}

/// Search upward from CWD for glrs-assume.team.toml
fn find_and_load_team_config() -> Result<Option<Config>> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir = cwd.as_path();

    loop {
        let team_path = dir.join("glrs-assume.team.toml");
        if team_path.exists() {
            let content = std::fs::read_to_string(&team_path).with_context(|| {
                format!("Failed to read team config from {}", team_path.display())
            })?;
            let team: Config = toml::from_str(&content).with_context(|| {
                format!("Failed to parse team config from {}", team_path.display())
            })?;
            return Ok(Some(team));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return Ok(None),
        }
    }
}

/// Merge team config under user config. User profiles win on alias conflict.
fn merge_team_config(user: &mut Config, team: &Config) {
    for (provider_id, team_provider) in &team.providers {
        let user_provider = user
            .providers
            .entry(provider_id.clone())
            .or_insert_with(|| ProviderConfig {
                enabled: team_provider.enabled,
                port: team_provider.port,
                default_region: team_provider.default_region.clone(),
                extra: team_provider.extra.clone(),
                profiles: Vec::new(),
            });

        // Merge profiles: add team profiles that don't conflict with user aliases
        let user_aliases: std::collections::HashSet<String> = user_provider
            .profiles
            .iter()
            .filter_map(|p| p.alias.clone())
            .collect();

        for team_profile in &team_provider.profiles {
            let dominated = team_profile
                .alias
                .as_ref()
                .map(|a| user_aliases.contains(a))
                .unwrap_or(false);
            if !dominated {
                user_provider.profiles.push(team_profile.clone());
            }
        }
    }
}

/// Ensure the config directory exists
pub fn ensure_config_dir() -> Result<()> {
    let dir = config_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("Failed to create config dir: {}", dir.display()))?;
    }
    Ok(())
}

/// Path to the init-completion marker file.
pub fn initialized_marker_path() -> PathBuf {
    config_dir().join("initialized.json")
}

/// Whether `gsa init` has completed successfully at least once.
///
/// The marker is written only at the very end of a successful init (after a
/// default context is chosen), so a half-configured state — `config.toml`
/// auto-created, daemon running, but no default context — still reads as
/// uninitialized. Everything except a small bootstrap allowlist refuses to
/// run until this returns true (see the init gate in `main.rs`).
pub fn is_initialized() -> bool {
    initialized_marker_path().exists()
}

/// Record that init completed. The body (version + timestamp) is for
/// diagnostics only; the file's existence is the load-bearing signal.
pub fn mark_initialized() -> Result<()> {
    ensure_config_dir()?;
    let path = initialized_marker_path();
    let body = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "initialized_at": chrono::Utc::now().to_rfc3339(),
    });
    std::fs::write(&path, serde_json::to_string_pretty(&body)? + "\n")
        .with_context(|| format!("Failed to write init marker to {}", path.display()))?;
    Ok(())
}

// ---- Legacy (pre-rebrand) config migration ----
//
// The tool first shipped as `gs-assume` (npm `@glorious/assume`) and stored
// config in `dirs::config_dir()/gs-assume`. The rebrand to `glrs-assume`
// (#220) moved it to `dirs::config_dir()/glrs-assume`. A user upgrading from
// the old package would otherwise start from scratch — losing their provider
// config, discovered contexts, and stored credentials. `gsa init` migrates the
// old directory forward once.

/// Pre-rebrand config directory: `dirs::config_dir()/gs-assume`.
fn legacy_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("gs-assume"))
}

/// Decide whether to migrate, given the relevant state. Pure, so the policy is
/// unit-testable without touching the real filesystem or environment.
///
/// Migrate only when: no explicit config-dir override is set (custom layouts
/// are the user's business), the current dir doesn't exist yet, and a legacy
/// dir is present.
fn migration_source(
    has_env_override: bool,
    current_exists: bool,
    legacy: Option<PathBuf>,
) -> Option<PathBuf> {
    if has_env_override || current_exists {
        return None;
    }
    legacy.filter(|p| p.exists())
}

/// One-time migration of the pre-rebrand `gs-assume` config directory to the
/// current `glrs-assume` location. Copies (never deletes) the legacy contents
/// so the user keeps their providers, contexts, and credentials. Returns the
/// legacy path when a migration actually happened, `None` otherwise.
pub fn migrate_legacy_config() -> Result<Option<PathBuf>> {
    let source = migration_source(
        std::env::var_os("GLRS_ASSUME_CONFIG_DIR").is_some(),
        config_dir().exists(),
        legacy_config_dir(),
    );
    let Some(legacy) = source else {
        return Ok(None);
    };
    let current = config_dir();
    copy_dir_recursive(&legacy, &current).with_context(|| {
        format!(
            "Failed to migrate config from {} to {}",
            legacy.display(),
            current.display()
        )
    })?;
    Ok(Some(legacy))
}

/// Recursively copy `src` into `dst`, creating `dst` as needed. Skips symlinks
/// and ephemeral daemon runtime files (the socket, pidfile, and logs) — those
/// belong to a running daemon and must not be carried across. Regular files
/// land at `0600` to match how the vault stores secrets.
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "daemon.sock" || name_str == "daemon.pid" || name_str.ends_with(".log") {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            std::fs::copy(&from, &to)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&to, std::fs::Permissions::from_mode(0o600));
            }
        }
        // Sockets/FIFOs/etc. are skipped.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::ProfileConfig;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert!(config.daemon.notification);
        assert_eq!(config.daemon.tick_interval_seconds, 60);
        assert_eq!(config.daemon.refresh_buffer_minutes, 5);
        assert_eq!(config.prompt.format, "[{provider}:{alias}]");
        assert!(config.log.enabled);
        assert_eq!(config.log.retention_days, 90);
        assert!(config.providers.is_empty());
    }

    #[test]
    fn test_parse_minimal_config() {
        let toml_str = r#"
[providers.aws]
enabled = true
start_url = "https://myorg.awsapps.com/start"
region = "us-east-1"
port = 9911
"#;
        let config: Config = toml::from_str(toml_str).unwrap();
        let aws = config.providers.get("aws").unwrap();
        assert!(aws.enabled);
        assert_eq!(aws.port, Some(9911));
    }

    #[test]
    fn test_parse_full_config() {
        let toml_str = r#"
[daemon]
notification = true
tick_interval_seconds = 30

[prompt]
format = "[{provider}:{context_name}]"

[log]
enabled = true
retention_days = 30

[providers.aws]
enabled = true
start_url = "https://myorg.awsapps.com/start"
region = "us-east-1"
port = 9911
default_region = "us-west-2"

[[providers.aws.profiles]]
account_id = "111111111111"
role_name = "AdministratorAccess"
alias = "prod/admin"
tags = ["production", "dangerous"]
color = "red"
confirm = true

[[providers.aws.profiles]]
account_id = "222222222222"
role_name = "DeployRole"
alias = "dev/deploy"
tags = ["development"]
color = "green"
region = "us-west-2"
"#;
        let config: Config = toml::from_str(toml_str).unwrap();
        assert_eq!(config.daemon.tick_interval_seconds, 30);
        let aws = config.providers.get("aws").unwrap();
        assert_eq!(aws.profiles.len(), 2);
        assert_eq!(aws.profiles[0].alias.as_deref(), Some("prod/admin"));
        assert!(aws.profiles[0].confirm);
        assert_eq!(aws.profiles[0].tags, vec!["production", "dangerous"]);
    }

    #[test]
    fn test_merge_team_config() {
        let mut user = Config::default();
        let user_aws = ProviderConfig {
            enabled: true,
            profiles: vec![ProfileConfig {
                alias: Some("dev/deploy".into()),
                tags: vec!["development".into()],
                color: Some("green".into()),
                confirm: false,
                region: None,
                max_duration_minutes: None,
                extra: HashMap::new(),
            }],
            ..Default::default()
        };
        user.providers.insert("aws".into(), user_aws);

        let mut team = Config::default();
        let team_aws = ProviderConfig {
            enabled: true,
            profiles: vec![
                ProfileConfig {
                    alias: Some("dev/deploy".into()), // conflicts — should be skipped
                    tags: vec!["team-dev".into()],
                    color: Some("blue".into()),
                    confirm: false,
                    region: None,
                    max_duration_minutes: None,
                    extra: HashMap::new(),
                },
                ProfileConfig {
                    alias: Some("prod/admin".into()), // no conflict — should be added
                    tags: vec!["production".into()],
                    color: Some("red".into()),
                    confirm: true,
                    region: None,
                    max_duration_minutes: None,
                    extra: HashMap::new(),
                },
            ],
            ..Default::default()
        };
        team.providers.insert("aws".into(), team_aws);

        merge_team_config(&mut user, &team);

        let aws = user.providers.get("aws").unwrap();
        assert_eq!(aws.profiles.len(), 2); // user's dev/deploy + team's prod/admin
        assert_eq!(aws.profiles[0].alias.as_deref(), Some("dev/deploy"));
        assert_eq!(aws.profiles[0].color.as_deref(), Some("green")); // user wins
        assert_eq!(aws.profiles[1].alias.as_deref(), Some("prod/admin"));
    }

    #[test]
    fn test_resolve_log_path_tilde() {
        let path = resolve_log_path("~/.config/glrs-assume/audit.log");
        assert!(!path.to_string_lossy().starts_with("~"));
    }

    #[test]
    fn test_resolve_log_path_absolute() {
        let path = resolve_log_path("/var/log/glrs-assume.log");
        assert_eq!(path, PathBuf::from("/var/log/glrs-assume.log"));
    }

    #[test]
    fn migration_source_skips_when_env_override_set() {
        // A custom config dir means the user controls layout — don't migrate.
        let legacy = std::env::temp_dir();
        assert_eq!(migration_source(true, false, Some(legacy)), None);
    }

    #[test]
    fn migration_source_skips_when_current_exists() {
        let legacy = std::env::temp_dir();
        assert_eq!(migration_source(false, true, Some(legacy)), None);
    }

    #[test]
    fn migration_source_skips_when_no_legacy_dir() {
        assert_eq!(migration_source(false, false, None), None);
        let absent = std::env::temp_dir().join("gsa-legacy-does-not-exist-xyz");
        assert_eq!(migration_source(false, false, Some(absent)), None);
    }

    #[test]
    fn migration_source_migrates_when_legacy_present_and_current_absent() {
        // temp_dir() always exists, standing in for a present legacy dir.
        let legacy = std::env::temp_dir();
        assert_eq!(
            migration_source(false, false, Some(legacy.clone())),
            Some(legacy)
        );
    }

    #[test]
    fn copy_dir_recursive_copies_files_recurses_and_skips_ephemeral() {
        let root = std::env::temp_dir().join(format!("gsa-copy-test-{}", std::process::id()));
        let src = root.join("src");
        let dst = root.join("dst");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(src.join("vault")).unwrap();

        std::fs::write(src.join("config.toml"), "x = 1").unwrap();
        std::fs::write(src.join("vault").join("creds.json"), "{}").unwrap();
        // Ephemeral runtime files that must NOT be carried across.
        std::fs::write(src.join("daemon.pid"), "123").unwrap();
        std::fs::write(src.join("audit.log"), "log").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert!(dst.join("config.toml").exists(), "config.toml copied");
        assert!(
            dst.join("vault").join("creds.json").exists(),
            "nested vault file copied"
        );
        assert!(!dst.join("daemon.pid").exists(), "pidfile skipped");
        assert!(!dst.join("audit.log").exists(), "log skipped");

        std::fs::remove_dir_all(&root).unwrap();
    }
}
