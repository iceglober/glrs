use crate::plugin::AuthTokens;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{Context, Result};
use std::path::PathBuf;

/// Encrypted credential storage.
///
/// Tokens are encrypted with AES-256-GCM and stored as files.
/// The encryption key is derived from a randomly generated local secret
/// stored at `config_dir/vault.key` with 0600 permissions.
/// This prevents casual plaintext exposure while avoiding OS keychain prompts.
fn vault_dir() -> PathBuf {
    super::config::config_dir().join("vault")
}

fn token_path(provider_id: &str) -> PathBuf {
    vault_dir().join(format!("{provider_id}.enc"))
}

fn client_path(provider_id: &str) -> PathBuf {
    vault_dir().join(format!("{provider_id}-client.enc"))
}

fn key_path() -> PathBuf {
    super::config::config_dir().join("vault.key")
}

/// Get or create the encryption key (32 bytes for AES-256).
fn get_or_create_key() -> Result<[u8; 32]> {
    let path = key_path();

    if path.exists() {
        let raw = std::fs::read(&path).context("Failed to read vault key")?;
        if raw.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&raw);
            return Ok(key);
        }
        // Corrupted key file — regenerate
        tracing::warn!("Vault key is corrupted, regenerating");
    }

    // Generate new key
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)?;
    std::fs::write(&path, key).context("Failed to write vault key")?;

    // Restrict permissions to owner only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(key)
}

/// Encrypt data and write to file.
fn encrypt_to_file(path: &PathBuf, plaintext: &[u8]) -> Result<()> {
    let key_bytes = get_or_create_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to create cipher: {e}"))?;

    // Generate random 12-byte nonce
    use rand::RngCore;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {e}"))?;

    // File format: [12 bytes nonce][ciphertext...]
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }

    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    std::fs::write(path, &output)
        .with_context(|| format!("Failed to write {}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

/// Read and decrypt a file. Returns None if file doesn't exist.
fn decrypt_from_file(path: &PathBuf) -> Result<Option<Vec<u8>>> {
    let raw = match std::fs::read(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    if raw.len() < 12 {
        anyhow::bail!("Encrypted file too short: {}", path.display());
    }

    let key_bytes = get_or_create_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to create cipher: {e}"))?;

    let nonce = Nonce::from_slice(&raw[..12]);
    let plaintext = cipher
        .decrypt(nonce, &raw[12..])
        .map_err(|_| anyhow::anyhow!("Decryption failed — vault key may have changed. Run: gs-assume login <provider>"))?;

    Ok(Some(plaintext))
}

/// Store auth tokens (encrypted)
pub fn store_tokens(provider_id: &str, tokens: &AuthTokens) -> Result<()> {
    let json = serde_json::to_string(tokens).context("Failed to serialize tokens")?;
    encrypt_to_file(&token_path(provider_id), json.as_bytes())?;
    tracing::debug!("Stored encrypted tokens for provider {provider_id}");
    Ok(())
}

/// Load auth tokens (decrypted)
pub fn load_tokens(provider_id: &str) -> Result<Option<AuthTokens>> {
    match decrypt_from_file(&token_path(provider_id))? {
        Some(plaintext) => {
            let tokens: AuthTokens = serde_json::from_slice(&plaintext)
                .with_context(|| format!("Failed to deserialize tokens for {provider_id}"))?;
            Ok(Some(tokens))
        }
        None => Ok(None),
    }
}

/// Delete auth tokens
pub fn delete_tokens(provider_id: &str) -> Result<()> {
    let path = token_path(provider_id);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Store OIDC client registration (encrypted)
pub fn store_client_registration(provider_id: &str, data: &serde_json::Value) -> Result<()> {
    let json = serde_json::to_string(data).context("Failed to serialize client registration")?;
    encrypt_to_file(&client_path(provider_id), json.as_bytes())?;
    tracing::debug!("Stored encrypted client registration for {provider_id}");
    Ok(())
}

/// Load OIDC client registration (decrypted)
pub fn load_client_registration(provider_id: &str) -> Result<Option<serde_json::Value>> {
    match decrypt_from_file(&client_path(provider_id))? {
        Some(plaintext) => {
            let data: serde_json::Value = serde_json::from_slice(&plaintext)
                .with_context(|| format!("Failed to deserialize client registration for {provider_id}"))?;
            Ok(Some(data))
        }
        None => Ok(None),
    }
}

/// Delete client registration
pub fn delete_client_registration(provider_id: &str) -> Result<()> {
    let path = client_path(provider_id);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Delete all stored data for a provider
pub fn delete_all(provider_id: &str) -> Result<()> {
    delete_tokens(provider_id)?;
    delete_client_registration(provider_id)?;
    tracing::info!("Cleared all stored data for provider {provider_id}");
    Ok(())
}
