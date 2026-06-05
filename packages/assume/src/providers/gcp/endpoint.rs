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
