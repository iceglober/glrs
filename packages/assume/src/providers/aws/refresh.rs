use crate::plugin::{AuthTokens, ProviderError};
use aws_sdk_ssooidc::Client as OidcClient;
use chrono::{Duration, Utc};

const GRANT_TYPE_REFRESH: &str = "refresh_token";

/// Build an OIDC client for the given region
async fn build_oidc_client(region: &str) -> OidcClient {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .no_credentials()
        .load()
        .await;
    OidcClient::new(&config)
}

/// Refresh the SSO access token using the refresh token.
/// Returns updated AuthTokens with new access_token and expiry.
///
/// Must be idempotent: calling refresh twice with the same tokens
/// must not invalidate the first result.
pub async fn refresh(tokens: &AuthTokens, region: &str) -> Result<AuthTokens, ProviderError> {
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

    // Check if refresh token itself has expired
    let now = Utc::now();
    if tokens.refresh_expires_at <= now {
        return Err(ProviderError::RefreshTokenExpired);
    }

    let client = build_oidc_client(region).await;

    let result = client
        .create_token()
        .client_id(client_id)
        .client_secret(client_secret)
        .grant_type(GRANT_TYPE_REFRESH)
        .refresh_token(refresh_token)
        .send()
        .await;

    match result {
        Ok(token_resp) => {
            let access_token = token_resp
                .access_token()
                .ok_or_else(|| ProviderError::Other("No access token in refresh response".into()))?
                .to_string();

            // AWS may issue a new refresh token on refresh
            let new_refresh_token = token_resp
                .refresh_token()
                .map(String::from)
                .unwrap_or_else(|| refresh_token.clone());

            let expires_in = token_resp.expires_in();
            let session_expires_at = now + Duration::seconds(expires_in as i64);

            // If we got a new refresh token, extend the refresh expiry
            let refresh_expires_at = if token_resp.refresh_token().is_some() {
                // New refresh token — reset the expiry window
                now + Duration::days(7)
            } else {
                // Same refresh token — keep existing expiry
                tokens.refresh_expires_at
            };

            let mut new_secrets = tokens.secrets.clone();
            new_secrets.insert("access_token".to_string(), access_token);
            new_secrets.insert("refresh_token".to_string(), new_refresh_token);

            Ok(AuthTokens {
                provider_id: "aws".to_string(),
                secrets: new_secrets,
                session_expires_at,
                refresh_expires_at,
            })
        }
        Err(sdk_err) => {
            let service_err = sdk_err.into_service_error();
            if service_err.is_unauthorized_client_exception()
                || service_err.is_invalid_grant_exception()
                || service_err.is_expired_token_exception()
            {
                Err(ProviderError::RefreshTokenExpired)
            } else if service_err.is_invalid_client_exception() {
                Err(ProviderError::Other(
                    "OIDC client registration expired. Run: gsa login aws".into(),
                ))
            } else {
                let err_str = format!("{service_err}");
                // Classify as network error if it looks transient
                if err_str.contains("timeout")
                    || err_str.contains("connection")
                    || err_str.contains("ConnectorError")
                {
                    Err(ProviderError::NetworkError(format!(
                        "Token refresh network error: {service_err}"
                    )))
                } else {
                    Err(ProviderError::Other(format!(
                        "Token refresh failed: {service_err}"
                    )))
                }
            }
        }
    }
}
