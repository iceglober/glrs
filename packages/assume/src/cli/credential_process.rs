use crate::core::{config, fuzzy, keychain};
use crate::plugin::registry::PluginRegistry;
use crate::providers::aws::credentials;
use anyhow::{bail, Result};
use clap::Args;

#[derive(Args, Debug)]
pub struct CredentialProcessArgs {
    /// Provider (must be "aws")
    #[arg(long, default_value = "aws")]
    pub provider: String,

    /// Context ID (e.g., "111111111111/AdminAccess")
    #[arg(long)]
    pub context: String,
}

pub async fn run(args: CredentialProcessArgs, registry: &PluginRegistry, _cfg: &config::Config) -> Result<()> {
    if args.provider != "aws" {
        bail!("credential-process is only supported for AWS");
    }

    let provider = registry
        .get(&args.provider)
        .ok_or_else(|| anyhow::anyhow!("AWS provider not registered"))?;

    let tokens = keychain::load_tokens(&args.provider)?
        .ok_or_else(|| anyhow::anyhow!("Not authenticated. Run: gs-assume login aws"))?;

    // Find the context
    let all_contexts = provider.list_contexts(&tokens).await.map_err(|e| {
        anyhow::anyhow!("Failed to list contexts: {e}")
    })?;

    let matches = fuzzy::match_contexts(&args.context, &all_contexts);
    let context = match matches.first() {
        Some(m) => &m.context,
        None => bail!("No context matching '{}'. Run: gs-assume sync aws", args.context),
    };

    // Get credentials
    let creds = provider.get_credentials(&tokens, context).await.map_err(|e| {
        anyhow::anyhow!("Failed to get credentials: {e}")
    })?;

    let sts = credentials::extract_sts_credentials(&creds)?;
    let output = sts.to_credential_process_response();

    // Output to stdout (this is what AWS CLI reads)
    println!("{}", serde_json::to_string(&output)?);

    Ok(())
}
