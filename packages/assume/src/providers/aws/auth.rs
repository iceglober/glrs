use crate::core::keychain;
use crate::plugin::{AuthTokens, ProviderConfig, ProviderError};
use aws_sdk_ssooidc::Client as OidcClient;
use chrono::{Duration, Utc};
use std::collections::HashMap;

const CLIENT_NAME: &str = "gs-assume";
const CLIENT_TYPE: &str = "public";
const GRANT_TYPE_DEVICE: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// Extract start_url from provider config
pub fn get_start_url(config: &ProviderConfig) -> Result<String, ProviderError> {
    config
        .extra
        .get("start_url")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| ProviderError::LoginFailed("Missing 'start_url' in AWS config".into()))
}

/// Extract SSO region from provider config
pub fn get_sso_region(config: &ProviderConfig) -> String {
    config
        .extra
        .get("region")
        .and_then(|v| v.as_str())
        .unwrap_or("us-east-1")
        .to_string()
}

/// Build an OIDC client for the given region
async fn build_oidc_client(region: &str) -> OidcClient {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .no_credentials()
        .load()
        .await;
    OidcClient::new(&config)
}

/// Perform the full OIDC device authorization flow.
/// Returns AuthTokens on success.
pub async fn login(config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
    let start_url = get_start_url(config)?;
    let region = get_sso_region(config);
    let client = build_oidc_client(&region).await;

    // Step 1: Register client (or reuse cached registration)
    let (client_id, client_secret) = get_or_register_client(&client).await?;

    // Step 2: Start device authorization
    let device_auth = client
        .start_device_authorization()
        .client_id(&client_id)
        .client_secret(&client_secret)
        .start_url(&start_url)
        .send()
        .await
        .map_err(|e| ProviderError::LoginFailed(format!("StartDeviceAuthorization failed: {e}")))?;

    let device_code = device_auth
        .device_code()
        .ok_or_else(|| ProviderError::LoginFailed("No device code returned".into()))?;
    let user_code = device_auth.user_code().unwrap_or("N/A");
    let verification_uri = device_auth
        .verification_uri_complete()
        .or(device_auth.verification_uri())
        .unwrap_or("https://device.sso.amazonaws.com/");
    let poll_interval = std::time::Duration::from_secs(device_auth.interval().max(1) as u64);

    // Step 3: Open browser and show user code
    eprintln!("Opening browser for AWS Identity Center...");
    eprintln!("If the browser doesn't open, visit: {verification_uri}");
    eprintln!("Enter code: {user_code}");

    if let Err(e) = open::that(verification_uri) {
        tracing::debug!("Failed to open browser: {e}");
    }

    // Step 4: Poll for token
    let tokens = poll_for_token(
        &client,
        &client_id,
        &client_secret,
        device_code,
        poll_interval,
    )
    .await?;

    Ok(tokens)
}

async fn get_or_register_client(client: &OidcClient) -> Result<(String, String), ProviderError> {
    // Check for cached client registration
    if let Ok(Some(cached)) = keychain::load_client_registration("aws") {
        if let (Some(id), Some(secret), Some(expires)) = (
            cached.get("client_id").and_then(|v| v.as_str()),
            cached.get("client_secret").and_then(|v| v.as_str()),
            cached.get("expires_at").and_then(|v| v.as_i64()),
        ) {
            let expires_at = chrono::DateTime::from_timestamp(expires, 0);
            if expires_at.is_some_and(|e| e > Utc::now()) {
                tracing::debug!("Using cached OIDC client registration");
                return Ok((id.to_string(), secret.to_string()));
            }
        }
    }

    // Register new client
    let reg = client
        .register_client()
        .client_name(CLIENT_NAME)
        .client_type(CLIENT_TYPE)
        .scopes("sso:account:access")
        .send()
        .await
        .map_err(|e| ProviderError::LoginFailed(format!("RegisterClient failed: {e}")))?;

    let client_id = reg
        .client_id()
        .ok_or_else(|| ProviderError::LoginFailed("No client_id returned".into()))?
        .to_string();
    let client_secret = reg
        .client_secret()
        .ok_or_else(|| ProviderError::LoginFailed("No client_secret returned".into()))?
        .to_string();
    let expires_at = reg.client_secret_expires_at();

    // Cache the registration in keychain
    let cache = serde_json::json!({
        "client_id": client_id,
        "client_secret": client_secret,
        "expires_at": expires_at,
    });
    if let Err(e) = keychain::store_client_registration("aws", &cache) {
        tracing::warn!("Failed to cache client registration: {e}");
    }

    Ok((client_id, client_secret))
}

async fn poll_for_token(
    client: &OidcClient,
    client_id: &str,
    client_secret: &str,
    device_code: &str,
    interval: std::time::Duration,
) -> Result<AuthTokens, ProviderError> {
    let max_attempts = 120; // ~10 minutes with 5s interval

    for attempt in 0..max_attempts {
        tokio::time::sleep(interval).await;

        let result = client
            .create_token()
            .client_id(client_id)
            .client_secret(client_secret)
            .grant_type(GRANT_TYPE_DEVICE)
            .device_code(device_code)
            .send()
            .await;

        match result {
            Ok(token_resp) => {
                let access_token = token_resp
                    .access_token()
                    .ok_or_else(|| ProviderError::LoginFailed("No access token returned".into()))?
                    .to_string();
                let refresh_token = token_resp
                    .refresh_token()
                    .map(String::from)
                    .unwrap_or_default();
                let expires_in = token_resp.expires_in();

                let now = Utc::now();
                let session_expires_at = now + Duration::seconds(expires_in as i64);
                // Refresh tokens typically last 1-90 days depending on IdC config
                // We'll set a conservative 7-day default and update on refresh
                let refresh_expires_at = now + Duration::days(7);

                let mut secrets = HashMap::new();
                secrets.insert("access_token".to_string(), access_token);
                secrets.insert("refresh_token".to_string(), refresh_token);
                secrets.insert("client_id".to_string(), client_id.to_string());
                secrets.insert("client_secret".to_string(), client_secret.to_string());

                return Ok(AuthTokens {
                    provider_id: "aws".to_string(),
                    secrets,
                    session_expires_at,
                    refresh_expires_at,
                });
            }
            Err(sdk_err) => {
                let err_str = format!("{sdk_err}");
                if err_str.contains("AuthorizationPendingException")
                    || err_str.contains("authorization_pending")
                {
                    if attempt % 12 == 0 && attempt > 0 {
                        eprintln!("Still waiting for browser authorization...");
                    }
                    continue;
                }
                if err_str.contains("SlowDownException") || err_str.contains("slow_down") {
                    tokio::time::sleep(interval).await; // Extra delay
                    continue;
                }
                if err_str.contains("ExpiredTokenException") || err_str.contains("expired_token") {
                    return Err(ProviderError::LoginFailed(
                        "Device authorization expired. Please try again.".into(),
                    ));
                }
                return Err(ProviderError::LoginFailed(format!(
                    "CreateToken failed: {sdk_err}"
                )));
            }
        }
    }

    Err(ProviderError::LoginFailed(
        "Authorization timed out after 10 minutes. Please try again.".into(),
    ))
}
