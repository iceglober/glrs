pub mod adc;
pub mod auth;
pub mod contexts;
pub mod credentials;
pub mod endpoint;
pub mod refresh;

use crate::plugin::{
    AuthTokens, Context, CredentialEndpoint, Credentials, ProfileConfig, PromptSegment, Provider,
    ProviderConfig, ProviderError, RefreshSchedule,
};
use async_trait::async_trait;
use std::time::Duration;

pub struct GcpProvider {
    default_region: String,
    port: u16,
    profiles: Vec<ProfileConfig>,
}

impl Default for GcpProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl GcpProvider {
    pub fn new() -> Self {
        Self {
            default_region: "us-central1".to_string(),
            port: endpoint::DEFAULT_PORT,
            profiles: Vec::new(),
        }
    }

    pub fn from_config(config: &ProviderConfig) -> Self {
        let default_region = config
            .default_region
            .clone()
            .unwrap_or_else(|| "us-central1".to_string());

        let port = config.port.unwrap_or(endpoint::DEFAULT_PORT);

        Self {
            default_region,
            port,
            profiles: config.profiles.clone(),
        }
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

    async fn login(&self, config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
        auth::login(config).await
    }

    async fn refresh(&self, tokens: &AuthTokens) -> Result<AuthTokens, ProviderError> {
        refresh::refresh(tokens).await
    }

    async fn list_contexts(&self, tokens: &AuthTokens) -> Result<Vec<Context>, ProviderError> {
        let mut ctxs = contexts::list_contexts(tokens, &self.default_region).await?;
        contexts::merge_profile_configs(&mut ctxs, &self.profiles);
        Ok(ctxs)
    }

    async fn get_credentials(
        &self,
        tokens: &AuthTokens,
        context: &Context,
    ) -> Result<Credentials, ProviderError> {
        credentials::get_credentials(tokens, context).await
    }

    fn credential_endpoint(&self) -> CredentialEndpoint {
        endpoint::build_endpoint(self.port)
    }

    fn shell_env(&self, endpoint_port: u16) -> Vec<(String, String)> {
        let port = if endpoint_port > 0 {
            endpoint_port
        } else {
            self.port
        };
        endpoint::shell_env(port, None)
    }

    fn prompt_segment(&self, context: &Context) -> PromptSegment {
        let alias = context
            .metadata
            .get("alias")
            .cloned()
            .unwrap_or_else(|| context.display_name.clone());

        let color = context.metadata.get("color").cloned().unwrap_or_else(|| {
            if context.tags.contains(&"dangerous".to_string())
                || context.tags.contains(&"production".to_string())
            {
                "red".to_string()
            } else {
                "blue".to_string()
            }
        });

        PromptSegment {
            text: format!("gcp:{alias}"),
            color,
        }
    }

    fn console_url(
        &self,
        context: &Context,
        _credentials: &Credentials,
    ) -> Result<String, ProviderError> {
        let project = context.metadata.get("project_id").unwrap_or(&context.id);
        Ok(format!(
            "https://console.cloud.google.com/home/dashboard?project={project}"
        ))
    }

    fn refresh_schedule(&self) -> RefreshSchedule {
        RefreshSchedule {
            check_interval: Duration::from_secs(60),
            refresh_buffer: Duration::from_secs(300), // 5 minutes
            credential_ttl: Duration::from_secs(3600), // 1 hour
        }
    }
}
