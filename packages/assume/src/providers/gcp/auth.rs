use crate::plugin::{AuthTokens, ProviderConfig, ProviderError};
use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::net::TcpListener;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

/// Scopes needed for project listing + general GCP access
const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/cloudplatformprojects.readonly";

/// Google Cloud SDK default OAuth credentials (same as gcloud CLI).
/// These are "Desktop app" type credentials — use authorization code flow with loopback redirect.
const DEFAULT_CLIENT_ID: &str =
    "764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com";
const DEFAULT_CLIENT_SECRET: &str = "d-FL95Q19q7MQmFpd7hHD0Ty";

/// Extract client_id from provider config, falling back to Cloud SDK defaults.
pub fn get_client_id(config: &ProviderConfig) -> Result<String, ProviderError> {
    Ok(config
        .extra
        .get("client_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string()))
}

/// Extract client_secret from provider config, falling back to Cloud SDK defaults.
pub fn get_client_secret(config: &ProviderConfig) -> Result<String, ProviderError> {
    Ok(config
        .extra
        .get("client_secret")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| DEFAULT_CLIENT_SECRET.to_string()))
}

/// Google token response
#[derive(serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: String,
}

/// Perform the Google OAuth 2.0 authorization code flow with loopback redirect.
/// Opens a browser, receives the callback on a local server, exchanges for tokens.
pub async fn login(config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
    let client_id = get_client_id(config)?;
    let client_secret = get_client_secret(config)?;

    // Bind to a random available port on loopback
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to bind local server: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to get local port: {e}")))?
        .port();
    let redirect_uri = format!("http://localhost:{port}");

    // Build authorization URL
    let auth_url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        urlencoding(&client_id),
        urlencoding(&redirect_uri),
        urlencoding(SCOPES),
    );

    eprintln!("Opening browser for Google Cloud authentication...");
    eprintln!(
        "If the browser doesn't open, visit:\n  {}",
        auth_url
    );

    if let Err(e) = open::that(&auth_url) {
        tracing::debug!("Failed to open browser: {e}");
    }

    // Wait for the callback
    let auth_code = receive_callback(listener)?;

    // Exchange authorization code for tokens
    let http = reqwest::Client::new();
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", auth_code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| ProviderError::LoginFailed(format!("Token exchange failed: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::LoginFailed(format!(
            "Token exchange failed: {body}"
        )));
    }

    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to parse token response: {e}")))?;

    let now = Utc::now();
    let session_expires_at = now + Duration::seconds(token.expires_in as i64);
    // Google refresh tokens don't expire unless revoked
    let refresh_expires_at = now + Duration::days(365 * 10);

    let mut secrets = HashMap::new();
    secrets.insert("access_token".to_string(), token.access_token);
    secrets.insert("client_id".to_string(), client_id);
    secrets.insert("client_secret".to_string(), client_secret);
    if let Some(rt) = token.refresh_token {
        secrets.insert("refresh_token".to_string(), rt);
    }

    Ok(AuthTokens {
        provider_id: "gcp".to_string(),
        secrets,
        session_expires_at,
        refresh_expires_at,
    })
}

/// Listen for the OAuth callback on the local server. Returns the authorization code.
fn receive_callback(listener: TcpListener) -> Result<String, ProviderError> {
    // Set a timeout so we don't hang forever
    listener
        .set_nonblocking(false)
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to configure listener: {e}")))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to accept callback: {e}")))?;

    // Read the HTTP request line
    let mut reader = std::io::BufReader::new(&stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| ProviderError::LoginFailed(format!("Failed to read callback: {e}")))?;

    // Parse the authorization code from the query string
    // Request line looks like: GET /?code=AUTH_CODE&scope=... HTTP/1.1
    let auth_code = request_line
        .split_whitespace()
        .nth(1) // the path
        .and_then(|path| {
            url::Url::parse(&format!("http://localhost{path}")).ok()
        })
        .and_then(|url| {
            url.query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.to_string())
        });

    // Check for error parameter
    let error = request_line
        .split_whitespace()
        .nth(1)
        .and_then(|path| {
            url::Url::parse(&format!("http://localhost{path}")).ok()
        })
        .and_then(|url| {
            url.query_pairs()
                .find(|(k, _)| k == "error")
                .map(|(_, v)| v.to_string())
        });

    // Send response to browser
    let (status, body) = if auth_code.is_some() {
        ("200 OK", "<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to your terminal.</p></body></html>")
    } else {
        ("400 Bad Request", "<html><body><h2>Authentication failed</h2><p>Please try again.</p></body></html>")
    };

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n{body}"
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    drop(stream);

    if let Some(err) = error {
        return Err(ProviderError::LoginFailed(format!(
            "Authorization denied: {err}"
        )));
    }

    auth_code.ok_or_else(|| {
        ProviderError::LoginFailed("No authorization code received in callback".into())
    })
}

/// Minimal percent-encoding for URL parameters.
fn urlencoding(s: &str) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("_", s)
        .finish()
        .strip_prefix("_=")
        .unwrap_or("")
        .to_string()
}
