//! GCP "refresh": gcloud owns the credential, so there is nothing for glrs to
//! refresh. We just validate that ADC can still mint a token (keep-warm) and
//! bump the session window. A failure here means gcloud needs interactive reauth
//! → `RefreshTokenExpired`, which the core turns into the needs-login banner.

use super::gcloud;
use crate::plugin::{AuthTokens, ProviderError};
use chrono::{Duration, Utc};

pub async fn refresh(tokens: &AuthTokens) -> Result<AuthTokens, ProviderError> {
    // Minting a token confirms ADC is still valid; the value is discarded (the
    // daemon does not serve GCP). On reauth lapse this returns RefreshTokenExpired.
    let _ = gcloud::adc_access_token()?;

    let mut refreshed = tokens.clone();
    refreshed.session_expires_at = Utc::now() + Duration::minutes(55);
    Ok(refreshed)
}
