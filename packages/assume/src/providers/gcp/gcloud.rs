//! Thin wrapper over the `gcloud` CLI. glrs delegates GCP auth to gcloud rather
//! than reimplementing Google OAuth, so gcloud owns reauth / MFA / org policy and
//! writes Application Default Credentials (ADC) the blessed way. Everything here
//! shells out to `gcloud`; nothing talks to Google directly.

use crate::plugin::ProviderError;
use std::io::ErrorKind;
use std::process::{Command, Stdio};

const GCLOUD: &str = "gcloud";

/// Run a blocking gcloud call off the async runtime. Every function here shells
/// out to `gcloud` and blocks; calling them directly inside an async fn pins a
/// tokio worker thread for the whole call. A gcloud invocation that stalls (a
/// slow network round-trip, a reauth round) would then starve workers until the
/// runtime can't even process its own shutdown signal — which is how daemons
/// ended up immortal and unkillable by SIGTERM. Offloading to the blocking pool
/// keeps the runtime responsive (and killable) no matter how long gcloud takes.
pub async fn offload<T, F>(f: F) -> Result<T, ProviderError>
where
    F: FnOnce() -> Result<T, ProviderError> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(f).await {
        Ok(inner) => inner,
        Err(e) => Err(ProviderError::Other(format!("gcloud task failed: {e}"))),
    }
}

/// Whether `gcloud` is on PATH. GCP is unavailable without it.
pub fn is_available() -> bool {
    Command::new(GCLOUD)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn not_installed() -> ProviderError {
    ProviderError::Other(
        "gcloud not found on PATH. Install the Google Cloud SDK: \
         https://cloud.google.com/sdk/docs/install"
            .to_string(),
    )
}

/// Run a non-interactive gcloud command, capturing stdout. stdin is closed so a
/// command that would otherwise prompt (e.g. a lapsed reauth) fails fast instead
/// of hanging — that failure is classified as `RefreshTokenExpired`.
fn run(args: &[&str]) -> Result<String, ProviderError> {
    let output = Command::new(GCLOUD)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                not_installed()
            } else {
                ProviderError::Other(format!("failed to run gcloud: {e}"))
            }
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(classify_error(&String::from_utf8_lossy(&output.stderr)))
    }
}

/// Map gcloud stderr to a typed error. A reauth challenge or missing/expired
/// credentials become `RefreshTokenExpired` so the core surfaces "run gsa login
/// gcp" (the interactive gcloud login satisfies reauth).
pub fn classify_error(stderr: &str) -> ProviderError {
    let s = stderr.to_lowercase();
    let needs_login = s.contains("reauth")
        || s.contains("invalid_rapt")
        || s.contains("invalid_grant")
        || s.contains("active account")
        || s.contains("does not have any valid credentials")
        || s.contains("there was a problem refreshing")
        || s.contains("gcloud auth login")
        || s.contains("application-default login")
        || s.contains("credentials were not found")
        || s.contains("not have application default credentials");
    if needs_login {
        ProviderError::RefreshTokenExpired
    } else if s.contains("network")
        || s.contains("timed out")
        || s.contains("could not reach")
        || s.contains("connection")
    {
        ProviderError::NetworkError(stderr.trim().to_string())
    } else {
        ProviderError::Other(stderr.trim().to_string())
    }
}

/// Run an interactive gcloud command (inherits the terminal so the browser opens
/// and reauth prompts work). Used only by `gsa login gcp`.
fn run_interactive(args: &[&str]) -> Result<(), ProviderError> {
    let status = Command::new(GCLOUD).args(args).status().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            not_installed()
        } else {
            ProviderError::LoginFailed(format!("failed to run gcloud {}: {e}", args.join(" ")))
        }
    })?;
    if status.success() {
        Ok(())
    } else {
        Err(ProviderError::LoginFailed(format!(
            "`gcloud {}` exited with status {}",
            args.join(" "),
            status.code().unwrap_or(-1)
        )))
    }
}

/// Interactive login for both the gcloud CLI and applications, in a single
/// browser visit. `--update-adc` writes the credentials obtained by `auth login`
/// to the Application Default Credentials (ADC) well-known location too, so apps
/// and the daemon's keep-warm both work without a second `auth application-default
/// login` — which opened a second browser and, when GOOGLE_APPLICATION_CREDENTIALS
/// points at the ADC file, an extra "Do you want to continue?" prompt in between.
/// Satisfies reauth.
pub fn login() -> Result<(), ProviderError> {
    if !is_available() {
        return Err(not_installed());
    }
    run_interactive(&["auth", "login", "--update-adc"])?;
    // `--update-adc` writes ADC from the CLI credentials but, unlike `auth
    // application-default login`, does not stamp a quota/billing project onto ADC.
    // Restore it (best-effort, non-interactive) so client libraries bill the
    // active project instead of warning and falling back to the resource-owning
    // project. A failure here doesn't undo a successful login, so swallow it.
    if let Some(project) = current_project() {
        let _ = run(&["auth", "application-default", "set-quota-project", &project]);
    }
    Ok(())
}

/// Re-run only the ADC login (`gcloud auth application-default login`) to refresh
/// a lapsed reauth proof (RAPT) — the credential apps read and the one that fails
/// with `invalid_rapt`. Used by the daemon for out-of-band recovery, so it must
/// never hang: stdin is closed (a console-code fallback gets EOF and exits fast
/// instead of waiting forever) and a wall-clock deadline kills a stuck process.
/// The browser is launched by gcloud; the loopback callback completes the flow.
pub fn reauth_adc() -> Result<(), ProviderError> {
    if !is_available() {
        return Err(not_installed());
    }

    let mut child = Command::new(GCLOUD)
        .args(["auth", "application-default", "login", "--launch-browser"])
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                not_installed()
            } else {
                ProviderError::LoginFailed(format!("failed to run gcloud ADC login: {e}"))
            }
        })?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(ProviderError::LoginFailed(format!(
                    "gcloud ADC login exited with status {}",
                    status.code().unwrap_or(-1)
                )))
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ProviderError::LoginFailed(
                        "gcloud ADC login timed out after 180s".to_string(),
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Err(e) => {
                return Err(ProviderError::LoginFailed(format!(
                    "error waiting for gcloud ADC login: {e}"
                )))
            }
        }
    }
}

/// The active gcloud account email, if any (no token required — reads local config).
pub fn active_account() -> Option<String> {
    let out = run(&[
        "auth",
        "list",
        "--filter=status:ACTIVE",
        "--format=value(account)",
    ])
    .ok()?;
    let acct = out.trim().to_string();
    (!acct.is_empty()).then_some(acct)
}

/// The gcloud CLI's configured default project (local config; no token).
pub fn current_project() -> Option<String> {
    let out = run(&["config", "get-value", "project"]).ok()?;
    let p = out.trim().to_string();
    // gcloud prints "(unset)" when no project is configured.
    (!p.is_empty() && p != "(unset)").then_some(p)
}

/// Set the gcloud CLI's default project.
pub fn set_project(project: &str) -> Result<(), ProviderError> {
    run(&["config", "set", "project", project]).map(|_| ())
}

/// Mint a fresh ADC access token. Fails (→ `RefreshTokenExpired`) when reauth is
/// due, since this path is non-interactive.
pub fn adc_access_token() -> Result<String, ProviderError> {
    let out = run(&["auth", "application-default", "print-access-token"])?;
    let token = out.trim().to_string();
    if token.is_empty() {
        Err(ProviderError::RefreshTokenExpired)
    } else {
        Ok(token)
    }
}

/// A GCP project as reported by `gcloud projects list --format=json`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub project_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub project_number: String,
    #[serde(default)]
    pub labels: Option<std::collections::HashMap<String, String>>,
}

/// List active projects via gcloud. Requires a valid session (fails on reauth).
pub fn list_projects() -> Result<Vec<Project>, ProviderError> {
    let json = run(&[
        "projects",
        "list",
        "--filter=lifecycleState:ACTIVE",
        "--format=json",
    ])?;
    parse_projects(&json)
}

/// Parse the JSON array from `gcloud projects list`. Split out for unit testing.
pub fn parse_projects(json: &str) -> Result<Vec<Project>, ProviderError> {
    serde_json::from_str::<Vec<Project>>(json)
        .map_err(|e| ProviderError::Other(format!("failed to parse gcloud projects list: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_projects_list_json() {
        let json = r#"[
            {"projectId":"ai-tooling-496018","name":"AI Tooling","projectNumber":"123","lifecycleState":"ACTIVE"},
            {"projectId":"prod-app","name":"Prod App","projectNumber":"456","lifecycleState":"ACTIVE","labels":{"env":"prod"}}
        ]"#;
        let p = parse_projects(json).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].project_id, "ai-tooling-496018");
        assert_eq!(p[0].name, "AI Tooling");
        assert_eq!(p[1].labels.as_ref().unwrap().get("env").unwrap(), "prod");
    }

    #[test]
    fn classifies_reauth_as_needs_login() {
        assert!(matches!(
            classify_error(
                "Reauthentication failed. cannot prompt during non-interactive execution"
            ),
            ProviderError::RefreshTokenExpired
        ));
        assert!(matches!(
            classify_error("reauth related error (invalid_rapt)"),
            ProviderError::RefreshTokenExpired
        ));
        assert!(matches!(
            classify_error("You do not currently have an active account selected"),
            ProviderError::RefreshTokenExpired
        ));
    }

    #[test]
    fn classifies_network_and_other() {
        assert!(matches!(
            classify_error("network is unreachable"),
            ProviderError::NetworkError(_)
        ));
        assert!(matches!(
            classify_error("PERMISSION_DENIED: nope"),
            ProviderError::Other(_)
        ));
    }
}
