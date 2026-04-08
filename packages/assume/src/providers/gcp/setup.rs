use crate::plugin::AuthTokens;
use anyhow::{bail, Result};
use std::io::{self, BufRead, Write};

const PROJECTS_URL: &str = "https://cloudresourcemanager.googleapis.com/v1/projects";
const BILLING_ACCOUNTS_URL: &str = "https://cloudbilling.googleapis.com/v1/billingAccounts";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BillingAccount {
    name: String,
    display_name: String,
    open: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BillingAccountsResponse {
    billing_accounts: Option<Vec<BillingAccount>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Operation {
    #[allow(dead_code)]
    name: Option<String>,
    error: Option<OperationError>,
}

#[derive(serde::Deserialize)]
struct OperationError {
    message: String,
}

fn prompt_line(message: &str) -> Result<String> {
    eprint!("{message}");
    io::stderr().flush()?;
    let mut input = String::new();
    io::stdin().lock().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

/// Offer to create a GCP project when none exist. Returns the project ID if created.
pub async fn maybe_create_project(tokens: &AuthTokens) -> Result<Option<String>> {
    let access_token = match tokens.secrets.get("access_token") {
        Some(t) => t,
        None => return Ok(None),
    };

    eprintln!();
    eprintln!("No GCP projects found. Would you like to create one?");
    let project_id = prompt_line("Project ID (e.g., my-app) or Enter to skip: ")?;
    if project_id.is_empty() {
        return Ok(None);
    }

    // Validate project ID format
    if project_id.len() < 6 || project_id.len() > 30 {
        bail!("Project ID must be 6-30 characters");
    }

    eprintln!("Creating project '{project_id}'...");

    let http = reqwest::Client::new();
    let resp = http
        .post(PROJECTS_URL)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "projectId": project_id,
            "name": project_id,
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        bail!("Failed to create project: HTTP {status} — {body}");
    }

    // Response is a long-running operation — poll until done
    let op: Operation = resp.json().await?;
    if let Some(err) = op.error {
        bail!("Failed to create project: {}", err.message);
    }

    // Wait for project to be ready (Resource Manager can take a moment)
    eprintln!("Waiting for project to be ready...");
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    // Link billing account
    if let Err(e) = link_billing(access_token, &project_id).await {
        eprintln!("Warning: Could not link billing: {e}");
        eprintln!("You may need to link a billing account manually in the GCP console.");
    }

    eprintln!("Project '{project_id}' created successfully.");
    Ok(Some(project_id))
}

async fn link_billing(access_token: &str, project_id: &str) -> Result<()> {
    let http = reqwest::Client::new();
    let resp = http
        .get(BILLING_ACCOUNTS_URL)
        .bearer_auth(access_token)
        .send()
        .await?;

    if !resp.status().is_success() {
        bail!("Could not list billing accounts");
    }

    let body: BillingAccountsResponse = resp.json().await?;
    let accounts: Vec<&BillingAccount> = body
        .billing_accounts
        .as_ref()
        .map(|accts| accts.iter().filter(|a| a.open.unwrap_or(false)).collect())
        .unwrap_or_default();

    if accounts.is_empty() {
        eprintln!("No billing accounts found — project created without billing.");
        return Ok(());
    }

    let billing_name = if accounts.len() == 1 {
        eprintln!("Linking billing account: {}", accounts[0].display_name);
        accounts[0].name.clone()
    } else {
        eprintln!("Available billing accounts:");
        for (i, acct) in accounts.iter().enumerate() {
            eprintln!("  [{}] {}", i + 1, acct.display_name);
        }
        let choice = prompt_line("Select billing account (number): ")?;
        let idx: usize = choice.parse().unwrap_or(0);
        if idx < 1 || idx > accounts.len() {
            bail!("Invalid selection");
        }
        accounts[idx - 1].name.clone()
    };

    let url = format!("https://cloudbilling.googleapis.com/v1/projects/{project_id}/billingInfo");
    let resp = http
        .put(&url)
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "billingAccountName": billing_name,
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        bail!("Failed to link billing: {body}");
    }

    eprintln!("Billing account linked.");
    Ok(())
}
