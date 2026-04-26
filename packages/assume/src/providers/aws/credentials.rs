use crate::plugin::{AuthTokens, Context, Credentials, ProviderError};
use aws_sdk_sso::Client as SsoClient;
use chrono::{DateTime, Utc};

/// Build an SSO client for the given region
async fn build_sso_client(region: &str) -> SsoClient {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .no_credentials()
        .load()
        .await;
    SsoClient::new(&config)
}

/// STS credentials returned by GetRoleCredentials
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StsCredentials {
    #[serde(rename = "AccessKeyId")]
    pub access_key_id: String,
    #[serde(rename = "SecretAccessKey")]
    pub secret_access_key: String,
    #[serde(rename = "Token")]
    pub session_token: String,
    #[serde(rename = "Expiration")]
    pub expiration: String,
}

impl StsCredentials {
    /// Format as the JSON expected by the AWS ECS credential endpoint
    /// (what AWS SDKs expect from the container credential provider)
    pub fn to_ecs_response(&self) -> serde_json::Value {
        serde_json::json!({
            "AccessKeyId": self.access_key_id,
            "SecretAccessKey": self.secret_access_key,
            "Token": self.session_token,
            "Expiration": self.expiration,
        })
    }

    /// Format as the JSON expected by AWS credential_process
    pub fn to_credential_process_response(&self) -> serde_json::Value {
        serde_json::json!({
            "Version": 1,
            "AccessKeyId": self.access_key_id,
            "SecretAccessKey": self.secret_access_key,
            "SessionToken": self.session_token,
            "Expiration": self.expiration,
        })
    }
}

/// Fetch short-lived STS role credentials for a specific account/role context.
pub async fn get_credentials(
    tokens: &AuthTokens,
    context: &Context,
    sso_region: &str,
) -> Result<Credentials, ProviderError> {
    let access_token = tokens
        .secrets
        .get("access_token")
        .ok_or(ProviderError::AccessTokenExpired)?;

    let account_id = context
        .metadata
        .get("account_id")
        .ok_or_else(|| ProviderError::ContextNotFound("Missing account_id in context".into()))?;

    let role_name = context
        .metadata
        .get("role_name")
        .ok_or_else(|| ProviderError::ContextNotFound("Missing role_name in context".into()))?;

    let client = build_sso_client(sso_region).await;

    let resp = client
        .get_role_credentials()
        .access_token(access_token)
        .account_id(account_id)
        .role_name(role_name)
        .send()
        .await
        .map_err(|e| {
            let err_str = format!("{e}");
            if err_str.contains("UnauthorizedException") || err_str.contains("unauthorized") {
                ProviderError::AccessTokenExpired
            } else if err_str.contains("ResourceNotFoundException") {
                ProviderError::ContextNotFound(format!(
                    "Account {account_id} role {role_name} not found"
                ))
            } else if err_str.contains("timeout") || err_str.contains("connection") {
                ProviderError::NetworkError(format!("GetRoleCredentials failed: {e}"))
            } else {
                ProviderError::Other(format!("GetRoleCredentials failed: {e}"))
            }
        })?;

    let role_creds = resp
        .role_credentials()
        .ok_or_else(|| ProviderError::Other("No role credentials in response".into()))?;

    let access_key_id = role_creds
        .access_key_id()
        .ok_or_else(|| ProviderError::Other("No access key ID in credentials".into()))?
        .to_string();

    let secret_access_key = role_creds
        .secret_access_key()
        .ok_or_else(|| ProviderError::Other("No secret access key in credentials".into()))?
        .to_string();

    let session_token = role_creds
        .session_token()
        .ok_or_else(|| ProviderError::Other("No session token in credentials".into()))?
        .to_string();

    let expiration_ms = role_creds.expiration();
    let expires_at = DateTime::from_timestamp_millis(expiration_ms)
        .unwrap_or_else(|| Utc::now() + chrono::Duration::hours(1));

    let sts_creds = StsCredentials {
        access_key_id,
        secret_access_key,
        session_token,
        expiration: expires_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    };

    // Serialize as ECS-format JSON (this is the opaque payload)
    let payload = serde_json::to_vec(&sts_creds.to_ecs_response())
        .map_err(|e| ProviderError::Other(format!("Failed to serialize credentials: {e}")))?;

    Ok(Credentials {
        provider_id: "aws".to_string(),
        context_id: context.id.clone(),
        expires_at,
        payload,
    })
}

/// Extract STS credentials from the opaque payload (for env var injection, credential_process, etc.)
pub fn extract_sts_credentials(credentials: &Credentials) -> Result<StsCredentials, ProviderError> {
    let ecs_json: serde_json::Value =
        serde_json::from_slice(&credentials.payload).map_err(|e| {
            ProviderError::Other(format!("Failed to deserialize credential payload: {e}"))
        })?;

    let access_key_id = ecs_json["AccessKeyId"]
        .as_str()
        .ok_or_else(|| ProviderError::Other("Missing AccessKeyId in credential payload".into()))?
        .to_string();
    let secret_access_key = ecs_json["SecretAccessKey"]
        .as_str()
        .ok_or_else(|| {
            ProviderError::Other("Missing SecretAccessKey in credential payload".into())
        })?
        .to_string();
    let session_token = ecs_json["Token"]
        .as_str()
        .ok_or_else(|| ProviderError::Other("Missing Token in credential payload".into()))?
        .to_string();
    let expiration = ecs_json["Expiration"]
        .as_str()
        .ok_or_else(|| ProviderError::Other("Missing Expiration in credential payload".into()))?
        .to_string();

    Ok(StsCredentials {
        access_key_id,
        secret_access_key,
        session_token,
        expiration,
    })
}
