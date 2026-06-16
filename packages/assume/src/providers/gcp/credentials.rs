use super::gcloud;
use crate::plugin::{AuthTokens, Context, Credentials, ProviderError};
use chrono::{Duration, Utc};

/// GCP access token response matching the metadata server format.
/// This is the opaque payload stored in Credentials.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GcpTokenPayload {
    pub access_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

/// Mint a fresh access token via gcloud ADC for the given context. Used by
/// `gsa exec` to inject `CLOUDSDK_AUTH_ACCESS_TOKEN`. Fails with
/// `RefreshTokenExpired` when gcloud needs interactive reauth.
pub async fn get_credentials(
    _tokens: &AuthTokens,
    context: &Context,
) -> Result<Credentials, ProviderError> {
    // Offloaded: served from the daemon's credential endpoint and refresh loop —
    // a hung gcloud must not block a runtime worker. See gcloud::offload.
    let access_token = gcloud::offload(gcloud::adc_access_token).await?;

    // ADC tokens are ~1h; advertise a conservative window.
    let expires_in: i64 = 3300;
    let expires_at = Utc::now() + Duration::seconds(expires_in);

    let payload = GcpTokenPayload {
        access_token,
        expires_in,
        token_type: "Bearer".to_string(),
    };

    let payload_bytes = serde_json::to_vec(&payload)
        .map_err(|e| ProviderError::Other(format!("Failed to serialize GCP credentials: {e}")))?;

    Ok(Credentials {
        provider_id: "gcp".to_string(),
        context_id: context.id.clone(),
        expires_at,
        payload: payload_bytes,
    })
}
