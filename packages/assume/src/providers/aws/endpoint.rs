use crate::plugin::{CredentialEndpoint, EndpointAuth};
use uuid::Uuid;

/// Default port for the AWS ECS credential endpoint
pub const DEFAULT_PORT: u16 = 9911;
/// Default path for the credential endpoint
pub const CREDENTIAL_PATH: &str = "/credentials";

/// Get or create a persistent session token shared between the daemon and shell-init.
/// Both processes must use the same token so the shell's AWS_CONTAINER_AUTHORIZATION_TOKEN
/// matches what the daemon expects. The token is stored in the config directory.
pub fn get_or_create_session_token() -> String {
    let path = crate::core::config::config_dir().join("session-token");

    // Try to read existing token
    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return token;
        }
    }

    // Generate new token and persist
    let token = Uuid::new_v4().to_string();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, &token);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    token
}

/// Build the credential endpoint configuration for the AWS plugin.
/// The bearer token is generated once per daemon session and shared
/// across all shell hooks via the `shell_env` method.
pub fn build_endpoint(port: u16, session_token: &str) -> CredentialEndpoint {
    CredentialEndpoint {
        port,
        path: CREDENTIAL_PATH.to_string(),
        required_headers: Vec::new(),
        auth_mechanism: EndpointAuth::BearerToken {
            token: session_token.to_string(),
        },
    }
}

/// Environment variables that tell AWS SDKs to use our credential endpoint
pub fn shell_env(port: u16, session_token: &str) -> Vec<(String, String)> {
    vec![
        (
            "AWS_CONTAINER_CREDENTIALS_FULL_URI".to_string(),
            format!("http://localhost:{port}{CREDENTIAL_PATH}"),
        ),
        (
            "AWS_CONTAINER_AUTHORIZATION_TOKEN".to_string(),
            session_token.to_string(),
        ),
    ]
}

/// Generate the AWS federation console sign-in URL.
/// Uses the GetSigninToken → Login flow.
pub fn console_url(access_key_id: &str, secret_access_key: &str, session_token: &str) -> String {
    // The federation URL accepts a JSON session blob
    let session_json = serde_json::json!({
        "sessionId": access_key_id,
        "sessionKey": secret_access_key,
        "sessionToken": session_token,
    });

    // First step: get a sign-in token
    // In practice this requires an HTTP call to the federation endpoint.
    // For now, construct the direct federation URL.
    let encoded_session = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("Action", "getSigninToken")
        .append_pair("SessionDuration", "3600")
        .append_pair("Session", &session_json.to_string())
        .finish();

    format!("https://signin.aws.amazon.com/federation?{encoded_session}")
}
