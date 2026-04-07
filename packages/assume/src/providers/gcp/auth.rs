use crate::plugin::{AuthTokens, ProviderConfig, ProviderError};
use chrono::{Duration, Utc};
use std::collections::HashMap;

const DEVICE_CODE_URL: &str = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// Scopes needed for project listing + general GCP access
const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/cloudplatformprojects.readonly";

/// Google Cloud SDK default OAuth credentials (same as gcloud CLI).
/// These are public client credentials for installed/device applications.
const DEFAULT_CLIENT_ID: &str =
    "764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com";
const DEFAULT_CLIENT_SECRET: &str = "d-FL95Q19q7MQmFpd7hHD0Ty";

/// Extract client_id from provider config, falling back to Cloud SDK defaults.
pub fn get_client_id(config: &ProviderConfig) -> Result<String, ProviderError> {
    Ok(config
        .extra
        .get("client_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string()))
}

/// Extract client_secret from provider config, falling back to Cloud SDK defaults.
pub fn get_client_secret(config: &ProviderConfig) -> Result<String, ProviderError> {
    Ok(config
        .extra
        .get("client_secret")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| DEFAULT_CLIENT_SECRET.to_string()))
}

/// Google device authorization response
#[derive(serde::Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_url: String,
    expires_in: u64,
    interval: u64,
}

/// Google token response
#[derive(serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
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

/// Perform the full Google OAuth 2.0 device authorization flow.
pub async fn login(config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
    let client_id = get_client_id(config)?;
    let client_secret = get_client_secret(config)?;
    let http = reqwest::Client::new();

    // Step 1: Request device + user codes
    let resp = http
        .post(DEVICE_CODE_URL)
        .form(&[("client_id", client_id.as_str()), ("scope", SCOPES)])
        .send()
        .await
        .map_err(|e| ProviderError::LoginFailed(format!("Device code request failed: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::LoginFailed(format!(
            "Device code request failed: {body}"
        )));
    }

    let device: DeviceCodeResponse = resp
        .json()
        .await
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to parse device code: {e}")))?;

    // Step 2: Open browser and show user code
    eprintln!("Opening browser for Google Cloud authentication...");
    eprintln!(
        "If the browser doesn't open, visit: {}",
        device.verification_url
    );
    eprintln!("Enter code: {}", device.user_code);

    if let Err(e) = open::that(&device.verification_url) {
        tracing::debug!("Failed to open browser: {e}");
    }

    // Step 3: Poll for token
    let poll_interval = std::time::Duration::from_secs(device.interval.max(5));
    let max_attempts = (device.expires_in / device.interval.max(5)).max(60) as usize;

    poll_for_token(
        &http,
        &client_id,
        &client_secret,
        &device.device_code,
        poll_interval,
        max_attempts,
    )
    .await
}

async fn poll_for_token(
    http: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    device_code: &str,
    interval: std::time::Duration,
    max_attempts: usize,
) -> Result<AuthTokens, ProviderError> {
    for attempt in 0..max_attempts {
        tokio::time::sleep(interval).await;

        let resp = http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::NetworkError(format!("Token poll failed: {e}")))?;

        let status = resp.status();
        let body = resp
            .bytes()
            .await
            .map_err(|e| ProviderError::NetworkError(format!("Failed to read response: {e}")))?;

        if status.is_success() {
            let token: TokenResponse = serde_json::from_slice(&body).map_err(|e| {
                ProviderError::LoginFailed(format!("Failed to parse token response: {e}"))
            })?;

            let now = Utc::now();
            let session_expires_at = now + Duration::seconds(token.expires_in as i64);
            // Google refresh tokens don't expire unless revoked
            let refresh_expires_at = now + Duration::days(365 * 10);

            let mut secrets = HashMap::new();
            secrets.insert("access_token".to_string(), token.access_token);
            secrets.insert("client_id".to_string(), client_id.to_string());
            secrets.insert("client_secret".to_string(), client_secret.to_string());
            if let Some(rt) = token.refresh_token {
                secrets.insert("refresh_token".to_string(), rt);
            }

            return Ok(AuthTokens {
                provider_id: "gcp".to_string(),
                secrets,
                session_expires_at,
                refresh_expires_at,
            });
        }

        // Parse error response
        let err: ErrorResponse = match serde_json::from_slice(&body) {
            Ok(e) => e,
            Err(_) => {
                return Err(ProviderError::LoginFailed(format!(
                    "Unexpected response: {}",
                    String::from_utf8_lossy(&body)
                )));
            }
        };

        match err.error.as_str() {
            "authorization_pending" => {
                if attempt % 12 == 0 && attempt > 0 {
                    eprintln!("Still waiting for browser authorization...");
                }
                continue;
            }
            "slow_down" => {
                tokio::time::sleep(interval).await;
                continue;
            }
            "expired_token" | "access_denied" => {
                return Err(ProviderError::LoginFailed(
                    "Device authorization expired or was denied. Please try again.".into(),
                ));
            }
            other => {
                return Err(ProviderError::LoginFailed(format!(
                    "Token request failed: {other}"
                )));
            }
        }
    }

    Err(ProviderError::LoginFailed(
        "Authorization timed out. Please try again.".into(),
    ))
}
