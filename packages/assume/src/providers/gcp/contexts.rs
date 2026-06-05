use super::gcloud;
use crate::plugin::{AuthTokens, Context, ProfileConfig, ProviderError};
use std::collections::HashMap;

/// List active GCP projects via `gcloud projects list`. Each project is a Context.
/// `tokens` is unused — gcloud holds the credential — but kept for trait symmetry.
pub async fn list_contexts(
    _tokens: &AuthTokens,
    default_region: &str,
) -> Result<Vec<Context>, ProviderError> {
    let projects = gcloud::list_projects()?;
    if projects.is_empty() {
        return Err(ProviderError::NoContextsAvailable);
    }

    let contexts = projects
        .into_iter()
        .map(|p| {
            let display_name = if p.name.is_empty() {
                p.project_id.clone()
            } else {
                p.name.clone()
            };

            let mut metadata = HashMap::new();
            metadata.insert("project_id".to_string(), p.project_id.clone());
            if !p.project_number.is_empty() {
                metadata.insert("project_number".to_string(), p.project_number.clone());
            }
            metadata.insert("project_name".to_string(), display_name.clone());
            if let Some(ref labels) = p.labels {
                for (k, v) in labels {
                    metadata.insert(format!("label:{k}"), v.clone());
                }
            }

            let searchable_fields = vec![p.project_id.clone(), display_name.clone()];

            Context {
                provider_id: "gcp".to_string(),
                id: p.project_id,
                display_name,
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
