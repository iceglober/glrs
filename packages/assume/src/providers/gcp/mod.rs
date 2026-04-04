pub mod auth;
pub mod contexts;
pub mod credentials;
pub mod endpoint;
pub mod refresh;

use crate::plugin::{
    AuthTokens, Context, CredentialEndpoint, Credentials, EndpointAuth, PromptSegment,
    Provider, ProviderConfig, ProviderError, RefreshSchedule,
};
use async_trait::async_trait;
use std::time::Duration;

pub struct GcpProvider;

impl GcpProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Provider for GcpProvider {
    fn trait_version(&self) -> u32 {
        1
    }

    fn id(&self) -> &'static str {
        "gcp"
    }

    fn display_name(&self) -> &'static str {
        "Google Cloud"
    }

    async fn login(&self, _config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
        Err(ProviderError::Other("GCP plugin not yet implemented. Coming soon.".into()))
    }

    async fn refresh(&self, _tokens: &AuthTokens) -> Result<AuthTokens, ProviderError> {
        Err(ProviderError::Other("GCP plugin not yet implemented".into()))
    }

    async fn list_contexts(&self, _tokens: &AuthTokens) -> Result<Vec<Context>, ProviderError> {
        Err(ProviderError::Other("GCP plugin not yet implemented".into()))
    }

    async fn get_credentials(
        &self,
        _tokens: &AuthTokens,
        _context: &Context,
    ) -> Result<Credentials, ProviderError> {
        Err(ProviderError::Other("GCP plugin not yet implemented".into()))
    }

    fn credential_endpoint(&self) -> CredentialEndpoint {
        CredentialEndpoint {
            port: 9912,
            path: "/computeMetadata/v1/instance/service-accounts/default/token".to_string(),
            required_headers: vec![("Metadata-Flavor".to_string(), "Google".to_string())],
            auth_mechanism: EndpointAuth::RequiredHeader {
                key: "Metadata-Flavor".to_string(),
                value: "Google".to_string(),
            },
        }
    }

    fn shell_env(&self, endpoint_port: u16) -> Vec<(String, String)> {
        let port = if endpoint_port > 0 { endpoint_port } else { 9912 };
        vec![
            ("GCE_METADATA_HOST".to_string(), format!("localhost:{port}")),
        ]
    }

    fn prompt_segment(&self, context: &Context) -> PromptSegment {
        PromptSegment {
            text: format!("gcp:{}", context.display_name),
            color: "blue".to_string(),
        }
    }

    fn console_url(
        &self,
        context: &Context,
        _credentials: &Credentials,
    ) -> Result<String, ProviderError> {
        let project = context.metadata.get("project_id").unwrap_or(&context.id);
        Ok(format!("https://console.cloud.google.com/home/dashboard?project={project}"))
    }

    fn refresh_schedule(&self) -> RefreshSchedule {
        RefreshSchedule {
            check_interval: Duration::from_secs(60),
            refresh_buffer: Duration::from_secs(300),
            credential_ttl: Duration::from_secs(3600),
        }
    }
}
