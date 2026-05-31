use assume::plugin::AuthTokens;
use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;
use std::sync::Mutex;
use tempfile::TempDir;

/// Global mutex to serialize tests that mutate `GLRS_ASSUME_CONFIG_DIR`.
/// Without this, parallel tests would clobber each other's env var.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// A temporary config directory that sets `GLRS_ASSUME_CONFIG_DIR` for the duration
/// of the test. Drop this to clean up.
pub struct TestVault {
    /// Kept alive so the temp directory isn't deleted until the test finishes.
    #[allow(dead_code)]
    pub dir: TempDir,
    /// Held for the lifetime of the vault to prevent other tests from
    /// changing the env var concurrently.
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl TestVault {
    /// Create a new isolated vault directory and set the env var.
    pub fn new() -> Self {
        // SAFETY: we hold the lock for the entire lifetime of TestVault,
        // so no two TestVaults can exist simultaneously in the same process.
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = TempDir::new().expect("failed to create temp dir");
        // Create the vault subdirectory so keychain can write files.
        std::fs::create_dir_all(dir.path().join("vault")).expect("failed to create vault dir");
        std::env::set_var("GLRS_ASSUME_CONFIG_DIR", dir.path());
        Self { dir, _guard: guard }
    }

    /// Write tokens to the vault using the keychain module.
    pub fn store_tokens(&self, tokens: &AuthTokens) {
        assume::core::keychain::store_tokens(&tokens.provider_id, tokens)
            .expect("failed to store tokens");
    }

    /// Load tokens from the vault.
    pub fn load_tokens(&self, provider_id: &str) -> Option<AuthTokens> {
        assume::core::keychain::load_tokens(provider_id).expect("failed to load tokens")
    }
}

impl Drop for TestVault {
    fn drop(&mut self) {
        // Remove the env var so subsequent tests start clean.
        std::env::remove_var("GLRS_ASSUME_CONFIG_DIR");
        // _guard is dropped here, releasing the lock.
    }
}

/// Build a set of `AuthTokens` suitable for testing.
///
/// - `session_expires_at`: when the access token expires
/// - `refresh_expires_at`: when the refresh token expires
pub fn make_test_tokens(
    session_expires_at: DateTime<Utc>,
    refresh_expires_at: DateTime<Utc>,
) -> AuthTokens {
    let mut secrets = HashMap::new();
    secrets.insert(
        "access_token".to_string(),
        "initial-access-token".to_string(),
    );
    secrets.insert(
        "refresh_token".to_string(),
        "initial-refresh-token".to_string(),
    );
    secrets.insert("client_id".to_string(), "test-client-id".to_string());
    secrets.insert(
        "client_secret".to_string(),
        "test-client-secret".to_string(),
    );

    AuthTokens {
        provider_id: "aws".to_string(),
        secrets,
        session_expires_at,
        refresh_expires_at,
    }
}

/// Convenience: tokens that expire in `session_secs` seconds and whose refresh
/// token expires in `refresh_days` days, relative to `now`.
pub fn make_tokens_relative(
    now: DateTime<Utc>,
    session_secs: i64,
    refresh_days: i64,
) -> AuthTokens {
    make_test_tokens(
        now + Duration::seconds(session_secs),
        now + Duration::days(refresh_days),
    )
}

/// Simple mock OIDC client for token rotation tests.
/// Returns a single pre-configured response every time.
pub struct MockOidcClientForRotation {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i32,
}

impl MockOidcClientForRotation {
    pub fn new(access_token: String, refresh_token: Option<String>, expires_in: i32) -> Self {
        Self { access_token, refresh_token, expires_in }
    }
}

#[async_trait::async_trait]
impl assume::providers::aws::oidc_client::OidcTokenClient for MockOidcClientForRotation {
    async fn create_token_refresh(
        &self,
        _client_id: &str,
        _client_secret: &str,
        _refresh_token: &str,
    ) -> Result<
        assume::providers::aws::oidc_client::CreateTokenResponse,
        assume::providers::aws::oidc_client::OidcError,
    > {
        Ok(assume::providers::aws::oidc_client::CreateTokenResponse {
            access_token: Some(self.access_token.clone()),
            refresh_token: self.refresh_token.clone(),
            expires_in: self.expires_in,
        })
    }
}
