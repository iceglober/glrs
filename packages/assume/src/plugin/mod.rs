pub mod registry;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Tokens stored in the OS keychain. Provider-opaque to the core.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTokens {
    pub provider_id: String,
    pub secrets: HashMap<String, String>,
    pub session_expires_at: DateTime<Utc>,
    /// Use DateTime::MAX equivalent for tokens that don't expire (e.g. GCP refresh tokens)
    pub refresh_expires_at: DateTime<Utc>,
}

/// A switchable identity within a provider. Every field is required.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Context {
    pub provider_id: String,
    pub id: String,
    pub display_name: String,
    pub searchable_fields: Vec<String>,
    pub tags: Vec<String>,
    pub metadata: HashMap<String, String>,
    pub region: String,
}

/// Short-lived credentials. Payload is opaque bytes — the core never
/// inspects or deserializes it. Only the plugin's HTTP handler reads it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub provider_id: String,
    pub context_id: String,
    pub expires_at: DateTime<Utc>,
    #[serde(with = "base64_bytes")]
    pub payload: Vec<u8>,
}

/// Helper module for serializing Vec<u8> as base64
mod base64_bytes {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        base64::engine::general_purpose::STANDARD
            .decode(&s)
            .map_err(serde::de::Error::custom)
    }
}

/// Refresh timing. All durations must be non-zero.
#[derive(Debug, Clone)]
pub struct RefreshSchedule {
    pub check_interval: Duration,
    pub refresh_buffer: Duration,
    pub credential_ttl: Duration,
}

/// An HTTP endpoint the daemon serves for credential delivery.
pub struct CredentialEndpoint {
    pub port: u16,
    pub path: String,
    #[allow(dead_code)]
    pub required_headers: Vec<(String, String)>,
    pub auth_mechanism: EndpointAuth,
}

#[derive(Debug, Clone)]
pub enum EndpointAuth {
    /// Bearer token in Authorization header (AWS ECS style).
    BearerToken { token: String },
    /// Required header key/value (GCP metadata style).
    RequiredHeader { key: String, value: String },
}

/// Shell prompt segment. Both fields are required.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptSegment {
    pub text: String,
    pub color: String,
}

/// Typed error enum. Plugins MUST use the correct variant so the core can take the right action.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("login failed: {0}")]
    LoginFailed(String),
    #[error("refresh token expired — re-authentication required")]
    RefreshTokenExpired,
    #[error("access token expired")]
    AccessTokenExpired,
    #[error("context not found: {0}")]
    ContextNotFound(String),
    #[error("no contexts available")]
    NoContextsAvailable,
    #[error("network error: {0}")]
    NetworkError(String),
    #[error("{0}")]
    Other(String),
}

/// The gs-assume plugin contract. Every method is required.
/// Every return type is concrete. No optionality.
///
/// TRAIT VERSION: 1
#[async_trait]
pub trait Provider: Send + Sync + 'static {
    /// Must return 1 for this version of the contract.
    fn trait_version(&self) -> u32;

    /// Unique, stable, lowercase identifier. e.g. "aws", "gcp".
    /// Must match: ^[a-z][a-z0-9_-]{0,31}$
    fn id(&self) -> &'static str;

    /// Human-readable name for UI display.
    fn display_name(&self) -> &'static str;

    /// Perform interactive authentication (browser, device code, etc.).
    /// Returns tokens with all fields populated.
    async fn login(&self, config: &ProviderConfig) -> Result<AuthTokens, ProviderError>;

    /// Silently refresh the session. No user interaction.
    /// Must be idempotent.
    async fn refresh(&self, tokens: &AuthTokens) -> Result<AuthTokens, ProviderError>;

    /// Return every context accessible with the current tokens.
    /// Must return non-empty Vec.
    async fn list_contexts(&self, tokens: &AuthTokens) -> Result<Vec<Context>, ProviderError>;

    /// Fetch short-lived credentials for a specific context.
    /// expires_at must be finite and in the future.
    async fn get_credentials(
        &self,
        tokens: &AuthTokens,
        context: &Context,
    ) -> Result<Credentials, ProviderError>;

    /// HTTP endpoint specification for credential delivery.
    fn credential_endpoint(&self) -> CredentialEndpoint;

    /// Environment variables the shell hook must set.
    /// Must return at least one entry.
    fn shell_env(&self, endpoint_port: u16) -> Vec<(String, String)>;

    /// Prompt segment for the active context.
    fn prompt_segment(&self, context: &Context) -> PromptSegment;

    /// URL to open the provider's web console.
    fn console_url(
        &self,
        context: &Context,
        credentials: &Credentials,
    ) -> Result<String, ProviderError>;

    /// Token and credential lifetimes for refresh scheduling.
    /// All durations must be non-zero. refresh_buffer < credential_ttl.
    fn refresh_schedule(&self) -> RefreshSchedule;
}

fn default_enabled() -> bool {
    true
}

/// Provider-specific configuration from the config file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub port: Option<u16>,
    pub default_region: Option<String>,
    /// Provider-specific settings (start_url for AWS, client_id for GCP, etc.)
    #[serde(flatten)]
    pub extra: HashMap<String, toml::Value>,
    /// Named profiles for this provider
    #[serde(default)]
    pub profiles: Vec<ProfileConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileConfig {
    pub alias: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub confirm: bool,
    pub region: Option<String>,
    pub max_duration_minutes: Option<u64>,
    /// Provider-specific fields (account_id, role_name, project_id, etc.)
    #[serde(flatten)]
    pub extra: HashMap<String, toml::Value>,
}
