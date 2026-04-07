use crate::plugin::{AuthTokens, ProviderError};
use chrono::{Duration, Utc};

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// Google token refresh response
#[derive(serde::Deserialize)]
struct RefreshResponse {
    access_token: String,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: String,
}

/// Google error response
#[derive(serde::Deserialize)]
struct ErrorResponse {
    error: String,
    #[allow(dead_code)]
    error_description: Option<String>,
}

/// Refresh the Google OAuth access token using the refresh token.
/// Google refresh tokens are long-lived (don't expire unless revoked),
/// so this should rarely fail.
pub async fn refresh(tokens: &AuthTokens) -> Result<AuthTokens, ProviderError> {
    let refresh_token = tokens
        .secrets
        .get("refresh_token")
        .filter(|t| !t.is_empty())
        .ok_or(ProviderError::RefreshTokenExpired)?;

    let client_id = tokens
        .secrets
        .get("client_id")
        .ok_or_else(|| ProviderError::Other("Missing client_id in stored tokens".into()))?;

    let client_secret = tokens
        .secrets
        .get("client_secret")
        .ok_or_else(|| ProviderError::Other("Missing client_secret in stored tokens".into()))?;

    let http = reqwest::Client::new();

    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() || e.is_connect() {
                ProviderError::NetworkError(format!("Token refresh network error: {e}"))
            } else {
                ProviderError::Other(format!("Token refresh failed: {e}"))
            }
        })?;

    let status = resp.status();
    let body = resp.bytes().await.map_err(|e| {
        ProviderError::NetworkError(format!("Failed to read refresh response: {e}"))
    })?;

    if status.is_success() {
        let token: RefreshResponse = serde_json::from_slice(&body)
            .map_err(|e| ProviderError::Other(format!("Failed to parse refresh response: {e}")))?;

        let now = Utc::now();
        let session_expires_at = now + Duration::seconds(token.expires_in as i64);

        let mut new_secrets = tokens.secrets.clone();
        new_secrets.insert("access_token".to_string(), token.access_token);
        // Google doesn't rotate refresh tokens on refresh — keep existing

        return Ok(AuthTokens {
            provider_id: "gcp".to_string(),
            secrets: new_secrets,
            session_expires_at,
            // Google refresh tokens don't expire unless revoked
            refresh_expires_at: tokens.refresh_expires_at,
        });
    }

    // Parse error
    let err: ErrorResponse = serde_json::from_slice(&body).map_err(|_| {
        ProviderError::Other(format!(
            "Token refresh failed ({}): {}",
            status,
            String::from_utf8_lossy(&body)
        ))
    })?;

    match err.error.as_str() {
        "invalid_grant" => Err(ProviderError::RefreshTokenExpired),
        other => {
            if other.contains("timeout") || other.contains("connection") {
                Err(ProviderError::NetworkError(format!(
                    "Token refresh error: {other}"
                )))
            } else {
                Err(ProviderError::Other(format!(
                    "Token refresh failed: {other}"
                )))
            }
        }
    }
}
