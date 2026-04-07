use crate::plugin::{AuthTokens, Context, ProfileConfig, ProviderError};
use std::collections::HashMap;

const PROJECTS_URL: &str =
    "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE";

/// A GCP project from the Resource Manager API
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    project_id: String,
    name: String,
    project_number: String,
    #[allow(dead_code)]
    lifecycle_state: Option<String>,
    labels: Option<HashMap<String, String>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectListResponse {
    projects: Option<Vec<Project>>,
    next_page_token: Option<String>,
}

/// List all active GCP projects accessible with the current tokens.
/// Each project becomes a Context.
pub async fn list_contexts(
    tokens: &AuthTokens,
    default_region: &str,
) -> Result<Vec<Context>, ProviderError> {
    let access_token = tokens
        .secrets
        .get("access_token")
        .ok_or(ProviderError::AccessTokenExpired)?;

    let http = reqwest::Client::new();
    let mut all_projects: Vec<Project> = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut url = PROJECTS_URL.to_string();
        if let Some(ref token) = page_token {
            url.push_str(&format!("&pageToken={token}"));
        }

        let resp = http
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() || e.is_connect() {
                    ProviderError::NetworkError(format!("ListProjects failed: {e}"))
                } else {
                    ProviderError::Other(format!("ListProjects failed: {e}"))
                }
            })?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED
            || resp.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err(ProviderError::AccessTokenExpired);
        }

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Other(format!(
                "ListProjects failed ({}): {body}",
                "non-200"
            )));
        }

        let list: ProjectListResponse = resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(format!("Failed to parse projects response: {e}")))?;

        if let Some(projects) = list.projects {
            all_projects.extend(projects);
        }

        page_token = list.next_page_token;
        if page_token.is_none() {
            break;
        }
    }

    if all_projects.is_empty() {
        return Err(ProviderError::NoContextsAvailable);
    }

    let contexts: Vec<Context> = all_projects
        .into_iter()
        .map(|p| {
            let mut metadata = HashMap::new();
            metadata.insert("project_id".to_string(), p.project_id.clone());
            metadata.insert("project_number".to_string(), p.project_number.clone());
            metadata.insert("project_name".to_string(), p.name.clone());
            if let Some(ref labels) = p.labels {
                for (k, v) in labels {
                    metadata.insert(format!("label:{k}"), v.clone());
                }
            }

            let searchable_fields = vec![
                p.project_id.clone(),
                p.name.clone(),
                p.project_number.clone(),
            ];

            Context {
                provider_id: "gcp".to_string(),
                id: p.project_id,
                display_name: p.name,
                searchable_fields,
                tags: Vec::new(),
                metadata,
                region: default_region.to_string(),
            }
        })
        .collect();

    Ok(contexts)
}

/// Auto-tag contexts whose project names suggest production environments.
pub fn auto_tag_dangerous(contexts: &mut [Context]) {
    let dangerous_patterns = ["prod", "production", "prd", "live"];

    for ctx in contexts.iter_mut() {
        let name = ctx.display_name.to_lowercase();
        let id = ctx.id.to_lowercase();

        let is_dangerous = dangerous_patterns
            .iter()
            .any(|p| name.contains(p) || id.contains(p));

        if is_dangerous && !ctx.tags.contains(&"dangerous".to_string()) {
            ctx.tags.push("dangerous".to_string());
        }
    }
}

/// Merge user-configured profile metadata into discovered contexts.
/// Matches on project_id.
pub fn merge_profile_configs(contexts: &mut [Context], profiles: &[ProfileConfig]) {
    for ctx in contexts.iter_mut() {
        let project_id = ctx
            .metadata
            .get("project_id")
            .map(String::as_str)
            .unwrap_or("");

        for profile in profiles {
            let profile_project = profile
                .extra
                .get("project_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if profile_project == project_id {
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
