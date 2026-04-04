use crate::core::config;
use anyhow::{Context, Result};
use chrono::Utc;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// Audit event types
#[derive(Debug, Clone, Copy)]
pub enum AuditEvent {
    Login,
    Logout,
    ContextSwitch,
    CredentialFetch,
    #[allow(dead_code)]
    SessionRefresh,
    DaemonStart,
    DaemonStop,
}

impl std::fmt::Display for AuditEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Login => write!(f, "LOGIN"),
            Self::Logout => write!(f, "LOGOUT"),
            Self::ContextSwitch => write!(f, "SWITCH"),
            Self::CredentialFetch => write!(f, "CRED_FETCH"),
            Self::SessionRefresh => write!(f, "REFRESH"),
            Self::DaemonStart => write!(f, "DAEMON_START"),
            Self::DaemonStop => write!(f, "DAEMON_STOP"),
        }
    }
}

/// Write an audit log entry
pub fn log_event(event: AuditEvent, provider: &str, details: &str) {
    if let Err(e) = write_audit_entry(event, provider, details) {
        tracing::debug!("Failed to write audit log: {e}");
    }
}

fn write_audit_entry(event: AuditEvent, provider: &str, details: &str) -> Result<()> {
    let log_path = resolve_audit_path();

    // Ensure parent directory exists
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!("Failed to create audit log directory: {}", parent.display())
        })?;
    }

    let timestamp = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let line = format!("{timestamp}\t{event}\t{provider}\t{details}\n");

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("Failed to open audit log: {}", log_path.display()))?;

    file.write_all(line.as_bytes())?;
    Ok(())
}

fn resolve_audit_path() -> PathBuf {
    config::config_dir().join("audit.log")
}

/// Read the last N audit log entries
#[allow(dead_code)]
pub fn read_recent(count: usize) -> Result<Vec<String>> {
    let log_path = resolve_audit_path();
    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&log_path)
        .with_context(|| format!("Failed to read audit log: {}", log_path.display()))?;

    let lines: Vec<String> = content
        .lines()
        .rev()
        .take(count)
        .map(String::from)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    Ok(lines)
}

/// Prune audit log entries older than retention_days
#[allow(dead_code)]
pub fn prune(retention_days: u64) -> Result<usize> {
    let log_path = resolve_audit_path();
    if !log_path.exists() {
        return Ok(0);
    }

    let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);
    let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let content = fs::read_to_string(&log_path)?;
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    let retained: Vec<&str> = lines
        .into_iter()
        .filter(|line| {
            // Keep lines whose timestamp is >= cutoff
            line.split('\t')
                .next()
                .map_or(true, |ts| ts >= cutoff_str.as_str())
        })
        .collect();

    let pruned = total - retained.len();
    if pruned > 0 {
        let new_content = retained.join("\n") + if retained.is_empty() { "" } else { "\n" };
        fs::write(&log_path, new_content)?;
        tracing::info!("Pruned {pruned} audit log entries older than {retention_days} days");
    }

    Ok(pruned)
}
