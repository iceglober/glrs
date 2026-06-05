//! GCP login: drive the gcloud CLI. gcloud owns the OAuth flow, reauth, MFA, org
//! policy, and writes Application Default Credentials. glrs stores only a small
//! marker so its keychain/status/needs-login machinery keeps working.

use super::gcloud;
use crate::plugin::{AuthTokens, ProviderConfig, ProviderError};
use chrono::{Duration, Utc};
use std::collections::HashMap;

/// Run `gcloud auth login` + `gcloud auth application-default login` (interactive,
/// satisfies reauth) and return a marker token. There is no glrs-held refresh
/// token — gcloud owns the credential; the marker just records that GCP is set up.
pub async fn login(_config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
    gcloud::login()?;

    let now = Utc::now();
    let mut secrets = HashMap::new();
    secrets.insert(
        "account".to_string(),
        gcloud::active_account().unwrap_or_default(),
    );
    secrets.insert("backend".to_string(), "gcloud".to_string());

    Ok(AuthTokens {
        provider_id: "gcp".to_string(),
        secrets,
        // ADC access tokens last ~1h; gcloud refreshes them. We keep-warm/validate
        // within this window and never hold a refresh token ourselves.
        session_expires_at: now + Duration::minutes(55),
        // gcloud owns the long-lived credential; the real ceiling is the org's
        // reauth window, surfaced via the needs-login marker on refresh failure.
        refresh_expires_at: now + Duration::days(365 * 10),
    })
}
