use super::Provider;
use anyhow::{bail, Result};
use std::collections::HashMap;
use std::sync::Arc;

/// Validates a provider ID matches ^[a-z][a-z0-9_-]{0,31}$
fn is_valid_provider_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 32 {
        return false;
    }
    let bytes = id.as_bytes();
    if !bytes[0].is_ascii_lowercase() {
        return false;
    }
    bytes[1..].iter().all(|&b| {
        b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-'
    })
}

pub struct PluginRegistry {
    providers: HashMap<String, Arc<dyn Provider>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    /// Register and validate a provider. Fails hard on any validation error.
    pub fn register(&mut self, provider: Arc<dyn Provider>) -> Result<()> {
        // Check trait version
        let version = provider.trait_version();
        if version != 1 {
            bail!(
                "Plugin '{}' requires contract v{}, core supports v1. Update the plugin or core.",
                provider.id(),
                version
            );
        }

        // Check ID format
        let id = provider.id();
        if !is_valid_provider_id(id) {
            bail!(
                "Plugin ID '{}' is invalid. Must match ^[a-z][a-z0-9_-]{{0,31}}$",
                id
            );
        }

        // Check for duplicate
        if self.providers.contains_key(id) {
            bail!("Plugin '{}' is already registered", id);
        }

        // Check shell_env is non-empty
        let env = provider.shell_env(0);
        if env.is_empty() {
            bail!("Plugin '{}': shell_env() returned empty vec", id);
        }

        // Check refresh schedule validity
        let schedule = provider.refresh_schedule();
        if schedule.check_interval.is_zero() {
            bail!("Plugin '{}': check_interval must be non-zero", id);
        }
        if schedule.refresh_buffer.is_zero() {
            bail!("Plugin '{}': refresh_buffer must be non-zero", id);
        }
        if schedule.credential_ttl.is_zero() {
            bail!("Plugin '{}': credential_ttl must be non-zero", id);
        }
        if schedule.refresh_buffer >= schedule.credential_ttl {
            bail!(
                "Plugin '{}': refresh_buffer ({:?}) must be less than credential_ttl ({:?})",
                id,
                schedule.refresh_buffer,
                schedule.credential_ttl
            );
        }

        self.providers.insert(id.to_string(), provider);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&Arc<dyn Provider>> {
        self.providers.get(id)
    }

    pub fn list(&self) -> Vec<&Arc<dyn Provider>> {
        let mut providers: Vec<_> = self.providers.values().collect();
        providers.sort_by_key(|p| p.id());
        providers
    }

    pub fn ids(&self) -> Vec<String> {
        let mut ids: Vec<_> = self.providers.keys().cloned().collect();
        ids.sort();
        ids
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.providers.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_provider_ids() {
        assert!(is_valid_provider_id("aws"));
        assert!(is_valid_provider_id("gcp"));
        assert!(is_valid_provider_id("azure-ad"));
        assert!(is_valid_provider_id("my_provider"));
        assert!(is_valid_provider_id("a"));
        assert!(is_valid_provider_id("provider123"));
    }

    #[test]
    fn test_invalid_provider_ids() {
        assert!(!is_valid_provider_id(""));
        assert!(!is_valid_provider_id("AWS")); // uppercase
        assert!(!is_valid_provider_id("1aws")); // starts with digit
        assert!(!is_valid_provider_id("-aws")); // starts with hyphen
        assert!(!is_valid_provider_id("a".repeat(33).as_str())); // too long
        assert!(!is_valid_provider_id("my provider")); // space
    }
}
