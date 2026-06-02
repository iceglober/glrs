use crate::plugin::{AuthTokens, ProviderError};
use crate::providers::aws::clock::{Clock, SystemClock};
use crate::providers::aws::oidc_client::{OidcError, OidcTokenClient, RealOidcClient};
use chrono::Duration;

/// Refresh the SSO access token using the refresh token.
/// Returns updated AuthTokens with new access_token and expiry.
///
/// Must be idempotent: calling refresh twice with the same tokens
/// must not invalidate the first result.
pub async fn refresh(tokens: &AuthTokens, region: &str) -> Result<AuthTokens, ProviderError> {
    let client = RealOidcClient::new(region).await;
    refresh_with(tokens, &client, &SystemClock).await
}

/// Testable entry point — accepts any `OidcTokenClient` and `Clock` implementation.
/// The production `refresh()` calls this with `RealOidcClient` and `SystemClock`.
pub async fn refresh_with(
    tokens: &AuthTokens,
    oidc: &dyn OidcTokenClient,
    clock: &dyn Clock,
) -> Result<AuthTokens, ProviderError> {
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
    let now = clock.now();
    if tokens.refresh_expires_at <= now {
        return Err(ProviderError::RefreshTokenExpired);
    }

    let result = oidc
        .create_token_refresh(client_id, client_secret, refresh_token)
        .await;

    match result {
        Ok(token_resp) => {
            let access_token = token_resp.access_token.ok_or_else(|| {
                ProviderError::Other("No access token in refresh response".into())
            })?;

            // AWS may issue a new refresh token on refresh
            let new_refresh_token = token_resp
                .refresh_token
                .clone()
                .unwrap_or_else(|| refresh_token.clone());

            let expires_in = token_resp.expires_in;
            let session_expires_at = now + Duration::seconds(expires_in as i64);

            // Keep the original refresh expiry — do NOT roll it forward.
            //
            // AWS rotates the refresh token on (almost) every refresh, but that
            // rotation does NOT extend the underlying SSO session: its hard max
            // is fixed at login and AWS never reports it. Resetting to now+7d on
            // each refresh fabricated a perpetual 7-day window — so `gsa status`
            // advertised days of life that didn't exist (the session really ends
            // at the org's IdC limit, often hours), and the daemon kept hammering
            // refresh near session end. Rotate the stored token value, but
            // preserve the expiry ceiling set at login.
            let refresh_expires_at = tokens.refresh_expires_at;

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
        Err(oidc_err) => match oidc_err {
            OidcError::InvalidGrant => Err(ProviderError::RefreshTokenExpired),
            OidcError::InvalidClient => Err(ProviderError::Other(
                "OIDC client registration expired. Run: gsa login aws".into(),
            )),
            OidcError::Network(msg) => Err(ProviderError::NetworkError(msg)),
            OidcError::Other(msg) => Err(ProviderError::Other(msg)),
        },
    }
}
