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

pub struct AwsProvider {
    sso_region: String,
    default_region: String,
    port: u16,
    session_token: String,
    profiles: Vec<ProfileConfig>,
}

impl AwsProvider {
    pub fn from_config(config: &ProviderConfig) -> Self {
        let sso_region = config
            .extra
            .get("region")
            .and_then(|v| v.as_str())
            .unwrap_or("us-east-1")
            .to_string();

        let default_region = config
            .default_region
            .clone()
            .unwrap_or_else(|| sso_region.clone());

        let port = config.port.unwrap_or(endpoint::DEFAULT_PORT);
        let session_token = endpoint::get_or_create_session_token();

        Self {
            sso_region,
            default_region,
            port,
            session_token,
            profiles: config.profiles.clone(),
        }
    }
}

#[async_trait]
impl Provider for AwsProvider {
    fn trait_version(&self) -> u32 {
        1
    }

    fn id(&self) -> &'static str {
        "aws"
    }

    fn display_name(&self) -> &'static str {
        "AWS Identity Center"
    }

    async fn login(&self, config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
        auth::login(config).await
    }

    async fn refresh(&self, tokens: &AuthTokens) -> Result<AuthTokens, ProviderError> {
        refresh::refresh(tokens, &self.sso_region).await
    }

    async fn list_contexts(&self, tokens: &AuthTokens) -> Result<Vec<Context>, ProviderError> {
        let mut ctxs =
            contexts::list_contexts(tokens, &self.sso_region, &self.default_region).await?;
        contexts::merge_profile_configs(&mut ctxs, &self.profiles);
        Ok(ctxs)
    }

    async fn get_credentials(
        &self,
        tokens: &AuthTokens,
        context: &Context,
    ) -> Result<Credentials, ProviderError> {
        credentials::get_credentials(tokens, context, &self.sso_region).await
    }

    fn credential_endpoint(&self) -> CredentialEndpoint {
        endpoint::build_endpoint(self.port, &self.session_token)
    }

    fn shell_env(&self, endpoint_port: u16) -> Vec<(String, String)> {
        let port = if endpoint_port > 0 {
            endpoint_port
        } else {
            self.port
        };
        endpoint::shell_env(port, &self.session_token)
    }

    fn prompt_segment(&self, context: &Context) -> PromptSegment {
        let alias = context.metadata.get("alias").cloned().unwrap_or_else(|| {
            let account = context
                .metadata
                .get("account_name")
                .map(String::as_str)
                .unwrap_or("?");
            let role = context
                .metadata
                .get("role_name")
                .map(String::as_str)
                .unwrap_or("?");
            format!("{account}/{role}")
        });

        let color = context.metadata.get("color").cloned().unwrap_or_else(|| {
            if context.tags.contains(&"dangerous".to_string())
                || context.tags.contains(&"production".to_string())
            {
                "red".to_string()
            } else {
                "green".to_string()
            }
        });

        PromptSegment {
            text: format!("aws:{alias}"),
            color,
        }
    }

    fn console_url(
        &self,
        _context: &Context,
        credentials: &Credentials,
    ) -> Result<String, ProviderError> {
        let sts = credentials::extract_sts_credentials(credentials)?;
        Ok(endpoint::console_url(
            &sts.access_key_id,
            &sts.secret_access_key,
            &sts.session_token,
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
