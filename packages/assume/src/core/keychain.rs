use crate::plugin::AuthTokens;
use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE_NAME: &str = "gs-assume";

/// Build a keyring entry for a provider's tokens.
/// Keychain entries are namespaced: service="gs-assume", user="{provider_id}:tokens"
fn token_entry(provider_id: &str) -> Result<Entry> {
    Entry::new(SERVICE_NAME, &format!("{provider_id}:tokens"))
        .map_err(|e| anyhow::anyhow!("Failed to create keyring entry for {provider_id}: {e}"))
}

/// Build a keyring entry for a provider's OIDC client registration.
/// Used by AWS to persist the client_id/client_secret across sessions.
fn client_entry(provider_id: &str) -> Result<Entry> {
    Entry::new(SERVICE_NAME, &format!("{provider_id}:client")).map_err(|e| {
        anyhow::anyhow!("Failed to create keyring entry for {provider_id}:client: {e}")
    })
}

/// Store auth tokens in the OS keychain
pub fn store_tokens(provider_id: &str, tokens: &AuthTokens) -> Result<()> {
    let entry = token_entry(provider_id)?;
    let json = serde_json::to_string(tokens).context("Failed to serialize tokens")?;
    entry.set_password(&json).map_err(|e| {
        anyhow::anyhow!("Failed to store tokens in keychain for {provider_id}: {e}")
    })?;
    tracing::debug!("Stored tokens in keychain for provider {provider_id}");
    Ok(())
}

/// Retrieve auth tokens from the OS keychain
pub fn load_tokens(provider_id: &str) -> Result<Option<AuthTokens>> {
    let entry = token_entry(provider_id)?;
    match entry.get_password() {
        Ok(json) => {
            let tokens: AuthTokens = serde_json::from_str(&json)
                .with_context(|| format!("Failed to deserialize tokens for {provider_id}"))?;
            tracing::debug!("Loaded tokens from keychain for provider {provider_id}");
            Ok(Some(tokens))
        }
        Err(keyring::Error::NoEntry) => {
            tracing::debug!("No tokens in keychain for provider {provider_id}");
            Ok(None)
        }
        Err(e) => Err(anyhow::anyhow!(
            "Failed to load tokens from keychain for {provider_id}: {e}"
        )),
    }
}

/// Delete auth tokens from the OS keychain
pub fn delete_tokens(provider_id: &str) -> Result<()> {
    let entry = token_entry(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => {
            tracing::info!("Deleted tokens from keychain for provider {provider_id}");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => {
            tracing::debug!("No tokens to delete for provider {provider_id}");
            Ok(())
        }
        Err(e) => Err(anyhow::anyhow!(
            "Failed to delete tokens from keychain for {provider_id}: {e}"
        )),
    }
}

/// Store OIDC client registration (used by AWS SSO)
pub fn store_client_registration(provider_id: &str, data: &serde_json::Value) -> Result<()> {
    let entry = client_entry(provider_id)?;
    let json = serde_json::to_string(data).context("Failed to serialize client registration")?;
    entry.set_password(&json).map_err(|e| {
        anyhow::anyhow!("Failed to store client registration for {provider_id}: {e}")
    })?;
    tracing::debug!("Stored client registration in keychain for {provider_id}");
    Ok(())
}

/// Load OIDC client registration
pub fn load_client_registration(provider_id: &str) -> Result<Option<serde_json::Value>> {
    let entry = client_entry(provider_id)?;
    match entry.get_password() {
        Ok(json) => {
            let data: serde_json::Value = serde_json::from_str(&json).with_context(|| {
                format!("Failed to deserialize client registration for {provider_id}")
            })?;
            Ok(Some(data))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow::anyhow!(
            "Failed to load client registration for {provider_id}: {e}"
        )),
    }
}

/// Delete client registration from keychain
pub fn delete_client_registration(provider_id: &str) -> Result<()> {
    let entry = client_entry(provider_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(
            "Failed to delete client registration for {provider_id}: {e}"
        )),
    }
}

/// Delete all keychain entries for a provider
pub fn delete_all(provider_id: &str) -> Result<()> {
    delete_tokens(provider_id)?;
    delete_client_registration(provider_id)?;
    tracing::info!("Cleared all keychain entries for provider {provider_id}");
    Ok(())
}
