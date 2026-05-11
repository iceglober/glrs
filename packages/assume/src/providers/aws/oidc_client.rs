use async_trait::async_trait;

/// The subset of the AWS OIDC CreateToken response that `refresh_with` needs.
/// Mirrors the fields extracted from `aws_sdk_ssooidc::operation::create_token::CreateTokenOutput`.
pub struct CreateTokenResponse {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: i32,
}

/// Error variants that `OidcTokenClient::create_token_refresh` can return.
/// These map directly to the `ProviderError` variants in `refresh_with`.
#[derive(Debug)]
pub enum OidcError {
    /// The grant is invalid or expired (maps to `ProviderError::RefreshTokenExpired`).
    InvalidGrant,
    /// The OIDC client registration has expired (maps to `ProviderError::Other`).
    InvalidClient,
    /// A transient network or connectivity error (maps to `ProviderError::NetworkError`).
    Network(String),
    /// Any other error (maps to `ProviderError::Other`).
    Other(String),
}

impl std::fmt::Display for OidcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OidcError::InvalidGrant => write!(f, "InvalidGrantException: grant is invalid"),
            OidcError::InvalidClient => write!(f, "InvalidClientException: client is invalid"),
            OidcError::Network(msg) => write!(f, "ConnectorError: {msg}"),
            OidcError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

/// Abstraction over the AWS OIDC CreateToken call.
/// The production implementation delegates to the real SDK client.
/// Tests inject a `MockOidcClient` that returns pre-configured responses.
#[async_trait]
pub trait OidcTokenClient: Send + Sync {
    async fn create_token_refresh(
        &self,
        client_id: &str,
        client_secret: &str,
        refresh_token: &str,
    ) -> Result<CreateTokenResponse, OidcError>;
}

/// Production implementation — wraps the real `aws_sdk_ssooidc::Client`.
pub struct RealOidcClient {
    inner: aws_sdk_ssooidc::Client,
}

impl RealOidcClient {
    pub async fn new(region: &str) -> Self {
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_config::Region::new(region.to_string()))
            .no_credentials()
            .load()
            .await;
        Self {
            inner: aws_sdk_ssooidc::Client::new(&config),
        }
    }

    /// Create a `RealOidcClient` with a custom endpoint URL (used in integration tests
    /// that spin up a wiremock server).
    #[allow(dead_code)]
    pub async fn with_endpoint(region: &str, endpoint_url: &str) -> Self {
        let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_config::Region::new(region.to_string()))
            .no_credentials()
            .endpoint_url(endpoint_url)
            .load()
            .await;
        Self {
            inner: aws_sdk_ssooidc::Client::new(&config),
        }
    }
}

#[async_trait]
impl OidcTokenClient for RealOidcClient {
    async fn create_token_refresh(
        &self,
        client_id: &str,
        client_secret: &str,
        refresh_token: &str,
    ) -> Result<CreateTokenResponse, OidcError> {
        let resp = self
            .inner
            .create_token()
            .client_id(client_id)
            .client_secret(client_secret)
            .grant_type("refresh_token")
            .refresh_token(refresh_token)
            .send()
            .await
            .map_err(|sdk_err| {
                let service_err = sdk_err.into_service_error();
                if service_err.is_unauthorized_client_exception()
                    || service_err.is_invalid_grant_exception()
                    || service_err.is_expired_token_exception()
                {
                    OidcError::InvalidGrant
                } else if service_err.is_invalid_client_exception() {
                    OidcError::InvalidClient
                } else {
                    let err_str = format!("{service_err}");
                    if err_str.contains("timeout")
                        || err_str.contains("connection")
                        || err_str.contains("ConnectorError")
                    {
                        OidcError::Network(format!("Token refresh network error: {service_err}"))
                    } else {
                        OidcError::Other(format!("Token refresh failed: {service_err}"))
                    }
                }
            })?;

        Ok(CreateTokenResponse {
            access_token: resp.access_token().map(String::from),
            refresh_token: resp.refresh_token().map(String::from),
            expires_in: resp.expires_in(),
        })
    }
}
