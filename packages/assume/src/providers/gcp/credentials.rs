use crate::plugin::{AuthTokens, Context, Credentials, ProviderError};
use chrono::Utc;

/// GCP access token response matching the metadata server format.
/// This is the opaque payload stored in Credentials.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GcpTokenPayload {
    pub access_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

/// Fetch a fresh access token for the given context.
/// For GCP, the access token from the OAuth session is already scoped to the user,
/// so we generate a short-lived access token via the OAuth2 tokeninfo or simply
/// use the current access token and report its remaining TTL.
///
/// If the access token is still valid, we reuse it. The daemon's refresh loop
/// handles refreshing the underlying OAuth session.
pub async fn get_credentials(
    tokens: &AuthTokens,
    context: &Context,
) -> Result<Credentials, ProviderError> {
    let access_token = tokens
        .secrets
        .get("access_token")
        .ok_or(ProviderError::AccessTokenExpired)?;

    let now = Utc::now();
    if tokens.session_expires_at <= now {
        return Err(ProviderError::AccessTokenExpired);
    }

    let expires_in = (tokens.session_expires_at - now).num_seconds().max(0);

    let payload = GcpTokenPayload {
        access_token: access_token.clone(),
        expires_in,
        token_type: "Bearer".to_string(),
    };

    let payload_bytes = serde_json::to_vec(&payload)
        .map_err(|e| ProviderError::Other(format!("Failed to serialize GCP credentials: {e}")))?;

    Ok(Credentials {
        provider_id: "gcp".to_string(),
        context_id: context.id.clone(),
        expires_at: tokens.session_expires_at,
        payload: payload_bytes,
    })
}

/// Extract the access token from a credential payload (for console URL, exec, etc.)
pub fn extract_access_token(credentials: &Credentials) -> Result<String, ProviderError> {
    let payload: GcpTokenPayload = serde_json::from_slice(&credentials.payload).map_err(|e| {
        ProviderError::Other(format!("Failed to deserialize GCP credential payload: {e}"))
    })?;
    Ok(payload.access_token)
}
