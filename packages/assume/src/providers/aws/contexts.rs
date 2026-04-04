use crate::plugin::{AuthTokens, Context, ProviderError};
use aws_sdk_sso::Client as SsoClient;
use std::collections::HashMap;

/// Build an SSO client for the given region
async fn build_sso_client(region: &str) -> SsoClient {
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .no_credentials()
        .load()
        .await;
    SsoClient::new(&config)
}

/// List all accounts and roles accessible with the current SSO access token.
/// Each account/role pair becomes a Context.
pub async fn list_contexts(
    tokens: &AuthTokens,
    region: &str,
    default_region: &str,
) -> Result<Vec<Context>, ProviderError> {
    let access_token = tokens
        .secrets
        .get("access_token")
        .ok_or(ProviderError::AccessTokenExpired)?;

    let client = build_sso_client(region).await;

    // Paginate through all accounts
    let mut accounts: Vec<aws_sdk_sso::types::AccountInfo> = Vec::new();
    let mut next_token: Option<String> = None;

    loop {
        let mut req = client.list_accounts().access_token(access_token);
        if let Some(token) = &next_token {
            req = req.next_token(token);
        }

        let resp = req.send().await.map_err(|e| {
            let err_str = format!("{e}");
            if err_str.contains("UnauthorizedException") || err_str.contains("unauthorized") {
                ProviderError::AccessTokenExpired
            } else if err_str.contains("timeout") || err_str.contains("connection") {
                ProviderError::NetworkError(format!("ListAccounts failed: {e}"))
            } else {
                ProviderError::Other(format!("ListAccounts failed: {e}"))
            }
        })?;

        let account_list = resp.account_list();
        accounts.extend(account_list.iter().cloned());

        next_token = resp.next_token().map(String::from);
        if next_token.is_none() {
            break;
        }
    }

    if accounts.is_empty() {
        return Err(ProviderError::NoContextsAvailable);
    }

    // For each account, list all roles
    let mut contexts = Vec::new();
    for account in &accounts {
        let account_id = account.account_id().unwrap_or("unknown");
        let account_name = account.account_name().unwrap_or(account_id);
        let email = account.email_address().unwrap_or("");

        let mut role_next_token: Option<String> = None;
        loop {
            let mut req = client
                .list_account_roles()
                .access_token(access_token)
                .account_id(account_id);
            if let Some(token) = &role_next_token {
                req = req.next_token(token);
            }

            let resp = req.send().await.map_err(|e| {
                let err_str = format!("{e}");
                if err_str.contains("UnauthorizedException") {
                    ProviderError::AccessTokenExpired
                } else {
                    ProviderError::Other(format!("ListAccountRoles failed for {account_id}: {e}"))
                }
            })?;

            {
                let role_list = resp.role_list();
                for role in role_list {
                    let role_name: &str = role.role_name().unwrap_or("unknown");
                    let context_id = format!("{account_id}/{role_name}");
                    let display_name = format!("{account_name} / {role_name}");

                    let mut metadata = HashMap::new();
                    metadata.insert("account_id".to_string(), account_id.to_string());
                    metadata.insert("account_name".to_string(), account_name.to_string());
                    metadata.insert("role_name".to_string(), role_name.to_string());
                    if !email.is_empty() {
                        metadata.insert("email".to_string(), email.to_string());
                    }

                    let searchable_fields = vec![
                        context_id.clone(),
                        display_name.clone(),
                        account_id.to_string(),
                        account_name.to_string(),
                        role_name.to_string(),
                    ];

                    contexts.push(Context {
                        provider_id: "aws".to_string(),
                        id: context_id,
                        display_name,
                        searchable_fields,
                        tags: Vec::new(), // Tags come from user config, merged later
                        metadata,
                        region: default_region.to_string(),
                    });
                }
            }

            role_next_token = resp.next_token().map(String::from);
            if role_next_token.is_none() {
                break;
            }
        }
    }

    if contexts.is_empty() {
        return Err(ProviderError::NoContextsAvailable);
    }

    Ok(contexts)
}

/// Merge user-configured profile metadata (alias, tags, color, region) into
/// discovered contexts. Matches on account_id + role_name.
pub fn merge_profile_configs(contexts: &mut [Context], profiles: &[crate::plugin::ProfileConfig]) {
    for ctx in contexts.iter_mut() {
        let account_id = ctx
            .metadata
            .get("account_id")
            .map(String::as_str)
            .unwrap_or("");
        let role_name = ctx
            .metadata
            .get("role_name")
            .map(String::as_str)
            .unwrap_or("");

        for profile in profiles {
            let profile_account = profile
                .extra
                .get("account_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let profile_role = profile
                .extra
                .get("role_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if profile_account == account_id && profile_role == role_name {
                // Apply profile config
                if let Some(ref alias) = profile.alias {
                    ctx.metadata.insert("alias".to_string(), alias.clone());
                    ctx.searchable_fields.push(alias.clone());
                }
                ctx.tags = profile.tags.clone();
                if let Some(ref color) = profile.color {
                    ctx.metadata.insert("color".to_string(), color.clone());
                }
                if let Some(ref region) = profile.region {
                    ctx.region = region.clone();
                }
                if profile.confirm {
                    ctx.tags.push("dangerous".to_string());
                }
                break;
            }
        }
    }
}
