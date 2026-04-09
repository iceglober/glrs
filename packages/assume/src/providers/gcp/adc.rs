//! Write Application Default Credentials (ADC) file so gcloud and client
//! libraries (Pulumi, Terraform, Go/Python/Node SDKs) authenticate
//! automatically without a separate `gcloud auth` step.

use crate::plugin::AuthTokens;
use std::path::PathBuf;

/// Standard ADC file path: ~/.config/gcloud/application_default_credentials.json
fn adc_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("gcloud")
        .join("application_default_credentials.json")
}

/// Write ADC file with the given tokens' refresh credentials.
/// This is the same format `gcloud auth application-default login` produces.
pub fn write_adc(tokens: &AuthTokens) {
    write_adc_to_path(tokens, &adc_path());
}

/// Write ADC file to a specific path. Extracted for testability.
pub fn write_adc_to_path(tokens: &AuthTokens, path: &std::path::Path) {
    let client_id = match tokens.secrets.get("client_id") {
        Some(id) => id,
        None => return,
    };
    let client_secret = match tokens.secrets.get("client_secret") {
        Some(s) => s,
        None => return,
    };
    let refresh_token = match tokens.secrets.get("refresh_token") {
        Some(rt) => rt,
        None => return,
    };

    let adc = serde_json::json!({
        "type": "authorized_user",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token
    });

    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    match std::fs::write(
        path,
        serde_json::to_string_pretty(&adc).unwrap_or_default(),
    ) {
        Ok(()) => {
            // Restrict permissions to owner only — this file contains credentials
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            }
            eprintln!("ADC written to {}", path.display());
        }
        Err(e) => tracing::warn!("Failed to write ADC: {e}"),
    }
}
