/// credential_endpoint.rs — Tests for the daemon's HTTP credential endpoint.
///
/// These tests spin up the real daemon HTTP server in-process with a mock
/// provider, then make HTTP requests and verify the responses. This exercises
/// the exact code path that AWS CLI/SDK hits when fetching credentials.
mod helpers;

use assume::core::config;
use assume::core::daemon::{DaemonState, SharedDaemonState};
use assume::plugin::registry::PluginRegistry;
use assume::plugin::{
    AuthTokens, Context, CredentialEndpoint, Credentials, EndpointAuth, PromptSegment,
    ProviderConfig, ProviderError, RefreshSchedule,
};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use helpers::make_tokens_relative;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

// ─── Mock provider ──────────────────────────────────────────────────────────

/// A controllable mock provider for testing the credential endpoint.
/// `get_credentials_responses` is a queue: each call pops the next response.
/// `refresh_responses` controls what `refresh()` returns.
struct MockProvider {
    get_cred_responses: Mutex<Vec<Result<Credentials, ProviderError>>>,
    refresh_responses: Mutex<Vec<Result<AuthTokens, ProviderError>>>,
    get_cred_call_count: AtomicUsize,
    refresh_call_count: AtomicUsize,
    port: u16,
    session_token: String,
}

impl MockProvider {
    fn new(
        port: u16,
        get_creds: Vec<Result<Credentials, ProviderError>>,
        refreshes: Vec<Result<AuthTokens, ProviderError>>,
    ) -> Self {
        Self {
            get_cred_responses: Mutex::new(get_creds),
            refresh_responses: Mutex::new(refreshes),
            get_cred_call_count: AtomicUsize::new(0),
            refresh_call_count: AtomicUsize::new(0),
            port,
            session_token: "test-bearer-token".to_string(),
        }
    }
}

fn make_test_credentials(ctx_id: &str) -> Credentials {
    let payload = serde_json::json!({
        "AccessKeyId": "AKIAIOSFODNN7EXAMPLE",
        "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "Token": "FwoGZXIvYXdzEBYaDHqa0AP",
        "Expiration": "2099-01-01T00:00:00Z"
    });
    Credentials {
        provider_id: "mock".to_string(),
        context_id: ctx_id.to_string(),
        expires_at: Utc::now() + Duration::hours(1),
        payload: serde_json::to_vec(&payload).unwrap(),
    }
}

fn make_test_context() -> Context {
    Context {
        provider_id: "mock".to_string(),
        id: "test-context-123".to_string(),
        display_name: "test-account / TestRole".to_string(),
        searchable_fields: vec!["test-account".to_string()],
        tags: vec![],
        metadata: HashMap::new(),
        region: "us-east-1".to_string(),
    }
}

#[async_trait]
impl assume::plugin::Provider for MockProvider {
    fn trait_version(&self) -> u32 {
        1
    }
    fn id(&self) -> &'static str {
        "mock"
    }
    fn display_name(&self) -> &'static str {
        "Mock Provider"
    }

    async fn login(&self, _config: &ProviderConfig) -> Result<AuthTokens, ProviderError> {
        Err(ProviderError::Other("not implemented".into()))
    }

    async fn refresh(&self, tokens: &AuthTokens) -> Result<AuthTokens, ProviderError> {
        self.refresh_call_count.fetch_add(1, Ordering::SeqCst);
        let mut responses = self.refresh_responses.lock().unwrap();
        if responses.is_empty() {
            let mut new_tokens = tokens.clone();
            new_tokens.session_expires_at = Utc::now() + Duration::hours(1);
            Ok(new_tokens)
        } else {
            responses.remove(0)
        }
    }

    async fn list_contexts(&self, _tokens: &AuthTokens) -> Result<Vec<Context>, ProviderError> {
        Ok(vec![make_test_context()])
    }

    async fn get_credentials(
        &self,
        _tokens: &AuthTokens,
        ctx: &Context,
    ) -> Result<Credentials, ProviderError> {
        self.get_cred_call_count.fetch_add(1, Ordering::SeqCst);
        let mut responses = self.get_cred_responses.lock().unwrap();
        if responses.is_empty() {
            Ok(make_test_credentials(&ctx.id))
        } else {
            responses.remove(0)
        }
    }

    fn credential_endpoint(&self) -> CredentialEndpoint {
        CredentialEndpoint {
            port: self.port,
            path: "/credentials".to_string(),
            required_headers: vec![],
            auth_mechanism: EndpointAuth::BearerToken {
                token: self.session_token.clone(),
            },
        }
    }

    fn shell_env(&self, port: u16) -> Vec<(String, String)> {
        vec![("MOCK_PORT".to_string(), port.to_string())]
    }

    fn prompt_segment(&self, _ctx: &Context) -> PromptSegment {
        PromptSegment {
            text: "mock".into(),
            color: "green".into(),
        }
    }

    fn console_url(&self, _ctx: &Context, _creds: &Credentials) -> Result<String, ProviderError> {
        Ok("https://example.com".into())
    }

    fn refresh_schedule(&self) -> RefreshSchedule {
        RefreshSchedule {
            check_interval: std::time::Duration::from_secs(60),
            refresh_buffer: std::time::Duration::from_secs(300),
            credential_ttl: std::time::Duration::from_secs(3600),
        }
    }
}

/// Build a DaemonState with the mock provider pre-loaded with tokens and context.
fn build_daemon_state(provider: Arc<MockProvider>, tokens: AuthTokens) -> SharedDaemonState {
    let mut registry = PluginRegistry::new();
    registry
        .register(provider.clone() as Arc<dyn assume::plugin::Provider>)
        .unwrap();

    let ctx = make_test_context();
    let config = config::Config::default();
    let mut state = DaemonState::new(config, registry);

    if let Some(ps) = state.plugin_states.get_mut("mock") {
        ps.tokens = Some(tokens);
        ps.status = assume::core::daemon::PluginStatus::Active;
        ps.active_context = Some(ctx.clone());
        ps.contexts = vec![ctx];
    }

    Arc::new(RwLock::new(state))
}

/// Find a free TCP port by binding to :0 and reading the assigned port.
fn free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

/// Make an HTTP request to the credential endpoint, returning (status_code, body).
async fn fetch_credentials(port: u16, path: &str, bearer: &str) -> (u16, String) {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{port}{path}"))
        .header("Authorization", format!("Bearer {bearer}"))
        .send()
        .await
        .expect("request should succeed");
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    (status, body)
}

// ─── Test 1: Credential endpoint retries after AccessTokenExpired ───────────

/// When the session token is expired and get_credentials returns
/// AccessTokenExpired, the credential endpoint should:
/// 1. Call provider.refresh() to get a fresh session token
/// 2. Retry get_credentials with the new token
/// 3. Return 200 with valid credentials
///
/// This is the exact path hit by `aws sts get-caller-identity` when the
/// daemon's session has expired between refresh loop ticks.
#[tokio::test]
async fn credential_endpoint_retries_after_session_expiry() {
    let port = free_port();
    let now = Utc::now();

    // Session expired, refresh still valid
    let tokens = make_tokens_relative(now - Duration::hours(2), 3600, 7);
    assert!(tokens.session_expires_at < now);

    let provider = Arc::new(MockProvider::new(
        port,
        vec![
            // First call: session expired
            Err(ProviderError::AccessTokenExpired),
            // Second call (after refresh): success
            Ok(make_test_credentials("test-context-123")),
        ],
        vec![], // refresh returns default (success)
    ));

    let state = build_daemon_state(provider.clone(), tokens);

    // Start the credential endpoint
    let _handles = assume::core::daemon::start_credential_endpoints(Arc::clone(&state))
        .await
        .unwrap();

    // Give the server a moment to bind
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Make a credential request
    let (status, body) =
        fetch_credentials(port, "/credentials/test-context-123", "test-bearer-token").await;

    assert_eq!(
        status, 200,
        "Expected 200 after retry, got {status}: {body}"
    );
    assert!(
        body.contains("AKIAIOSFODNN7EXAMPLE"),
        "Response should contain credentials"
    );

    // Verify: get_credentials called twice (fail + retry), refresh called once
    assert_eq!(provider.get_cred_call_count.load(Ordering::SeqCst), 2);
    assert_eq!(provider.refresh_call_count.load(Ordering::SeqCst), 1);
}

// ─── Test 2: Concurrent requests during refresh ────────────────────────────

/// When multiple credential requests arrive simultaneously with an expired
/// session, they should all eventually succeed. The first request triggers
/// the refresh; subsequent requests may also trigger refreshes (idempotent)
/// or hit the now-refreshed cache.
#[tokio::test]
async fn concurrent_requests_during_expired_session() {
    let port = free_port();
    let now = Utc::now();

    let tokens = make_tokens_relative(now - Duration::hours(2), 3600, 7);

    // All credential calls fail with AccessTokenExpired first, then succeed.
    // We need enough responses for N concurrent requests, each doing fail+retry.
    let mut get_cred_responses = Vec::new();
    for _ in 0..5 {
        get_cred_responses.push(Err(ProviderError::AccessTokenExpired));
        get_cred_responses.push(Ok(make_test_credentials("test-context-123")));
    }

    let provider = Arc::new(MockProvider::new(
        port,
        get_cred_responses,
        vec![], // refresh always succeeds
    ));

    let state = build_daemon_state(provider.clone(), tokens);
    let _handles = assume::core::daemon::start_credential_endpoints(Arc::clone(&state))
        .await
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Fire 5 concurrent requests
    let mut handles = Vec::new();
    for _ in 0..5 {
        handles.push(tokio::spawn(async move {
            fetch_credentials(port, "/credentials/test-context-123", "test-bearer-token").await
        }));
    }

    let results: Vec<(u16, String)> = futures::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();

    let successes = results.iter().filter(|(s, _)| *s == 200).count();
    assert!(
        successes >= 4,
        "Expected at least 4/5 concurrent requests to succeed, got {successes}/5. \
         Results: {:?}",
        results.iter().map(|(s, _)| s).collect::<Vec<_>>()
    );
}

// ─── Test 3: Multi-cycle token rotation ────────────────────────────────────

/// Simulate 3 consecutive refresh cycles where AWS rotates the refresh token
/// each time. The refresh chain must not break, the stored token value must
/// rotate each cycle, and `refresh_expires_at` must be PRESERVED (the expiry
/// ceiling set at login) — never rolled forward — since rotation doesn't extend
/// the underlying SSO session.
#[tokio::test]
async fn multi_cycle_token_rotation_preserves_refresh_window() {
    use assume::providers::aws::clock::MockClock;
    use assume::providers::aws::refresh::refresh_with;

    let now = Utc::now();
    let mut tokens = make_tokens_relative(now, 300, 7);
    let original_refresh_expiry = tokens.refresh_expires_at; // now + 7 days

    for cycle in 0..3 {
        let clock = MockClock::new(now + Duration::hours(cycle));
        let mock_client = helpers::MockOidcClientForRotation::new(
            format!("access-token-cycle-{cycle}"),
            Some(format!("refresh-token-cycle-{cycle}")),
            3600,
        );

        let new_tokens = refresh_with(&tokens, &mock_client, &clock)
            .await
            .unwrap_or_else(|e| panic!("Cycle {cycle} failed: {e}"));

        // Access token updated
        assert_eq!(
            new_tokens.secrets.get("access_token").unwrap(),
            &format!("access-token-cycle-{cycle}"),
        );

        // Refresh token rotated
        assert_eq!(
            new_tokens.secrets.get("refresh_token").unwrap(),
            &format!("refresh-token-cycle-{cycle}"),
        );

        // Refresh expiry preserved — NOT reset to this cycle's clock + 7 days.
        assert_eq!(
            new_tokens.refresh_expires_at, original_refresh_expiry,
            "Cycle {cycle}: refresh_expires_at must be preserved, not rolled forward"
        );

        tokens = new_tokens;
    }
}

// ─── Test 4: Network failure → no NeedsLogin, retry next tick ──────────────

/// When a refresh attempt fails due to a network error, the daemon should
/// NOT mark the provider as NeedsLogin. It should stay Active and retry on
/// the next tick. Only RefreshTokenExpired triggers NeedsLogin.
#[tokio::test]
async fn network_failure_does_not_trigger_needs_login() {
    use assume::providers::aws::clock::MockClock;
    use assume::providers::aws::oidc_client::{CreateTokenResponse, OidcError, OidcTokenClient};
    use assume::providers::aws::refresh::refresh_with;

    struct NetworkFailClient;

    #[async_trait]
    impl OidcTokenClient for NetworkFailClient {
        async fn create_token_refresh(
            &self,
            _client_id: &str,
            _client_secret: &str,
            _refresh_token: &str,
        ) -> Result<CreateTokenResponse, OidcError> {
            Err(OidcError::Network("connection timed out".into()))
        }
    }

    let now = Utc::now();
    let tokens = make_tokens_relative(now, 60, 7);
    let clock = MockClock::new(now);

    let result = refresh_with(&tokens, &NetworkFailClient, &clock).await;

    // Should be NetworkError, NOT RefreshTokenExpired
    match result {
        Err(ProviderError::NetworkError(msg)) => {
            assert!(msg.contains("connection timed out"), "msg: {msg}");
        }
        other => panic!(
            "Expected NetworkError, got: {other:?}. \
             Network failures must NOT be mapped to RefreshTokenExpired."
        ),
    }
}
