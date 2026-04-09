use crate::core::daemon::DaemonRequirement;
use crate::core::{audit, keychain};
use crate::plugin::registry::PluginRegistry;
use anyhow::Result;
use clap::Args;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

#[derive(Args, Debug)]
pub struct LogoutArgs {
    /// Provider to logout from (omit for all providers)
    pub provider: Option<String>,
}

pub async fn run(args: LogoutArgs, registry: &PluginRegistry) -> Result<()> {
    let provider_ids: Vec<String> = match args.provider {
        Some(ref id) => {
            if registry.get(id).is_none() {
                anyhow::bail!("Unknown provider: {id}");
            }
            vec![id.clone()]
        }
        None => registry.ids(),
    };

    for provider_id in &provider_ids {
        let provider = registry.get(provider_id).unwrap();

        keychain::delete_all(provider_id)?;

        // Clear active context if it belonged to this provider
        if let Some(active) = crate::core::cache::load_active_context() {
            if active.provider_id == *provider_id {
                crate::core::cache::clear_active_context();
            }
        }

        eprintln!("Logged out from {}", provider.display_name());

        audit::log_event(
            audit::AuditEvent::Logout,
            provider_id,
            provider.display_name(),
        );
    }

    if provider_ids.len() > 1 {
        eprintln!("Logged out from all providers");
    }

    Ok(())
}
