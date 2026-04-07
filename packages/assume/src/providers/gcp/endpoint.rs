use crate::plugin::{CredentialEndpoint, EndpointAuth};

/// Default port for the GCP metadata server emulation
pub const DEFAULT_PORT: u16 = 9912;

/// Path that GCP SDKs query for access tokens
pub const TOKEN_PATH: &str = "/computeMetadata/v1/instance/service-accounts/default/token";

/// Build the credential endpoint configuration for the GCP plugin.
/// Uses the Metadata-Flavor: Google header for auth (matching the real GCE metadata server).
pub fn build_endpoint(port: u16) -> CredentialEndpoint {
    CredentialEndpoint {
        port,
        path: TOKEN_PATH.to_string(),
        required_headers: vec![("Metadata-Flavor".to_string(), "Google".to_string())],
        auth_mechanism: EndpointAuth::RequiredHeader {
            key: "Metadata-Flavor".to_string(),
            value: "Google".to_string(),
        },
    }
}

/// Environment variables that tell GCP SDKs to use our metadata server
pub fn shell_env(port: u16, project_id: Option<&str>) -> Vec<(String, String)> {
    let mut vars = vec![("GCE_METADATA_HOST".to_string(), format!("localhost:{port}"))];
    if let Some(project) = project_id {
        vars.push(("GOOGLE_CLOUD_PROJECT".to_string(), project.to_string()));
        vars.push(("CLOUDSDK_CORE_PROJECT".to_string(), project.to_string()));
    }
    vars
}
