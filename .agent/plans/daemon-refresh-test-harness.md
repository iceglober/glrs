# Daemon refresh lifecycle test harness

## Goal

Introduce a containerized test harness with mocked AWS OIDC endpoints that exercises the full daemon refresh lifecycle — login → token persistence → daemon refresh → token rotation → daemon crash/recovery → time advancement past expiry boundaries. This enables reproducing the "forced browser login 1-2x/day despite 7-day refresh token" bug without hitting real AWS, and provides regression coverage for the refresh loop going forward.

## Constraints

- **No production code behavior changes.** The refactoring introduces a trait boundary for the OIDC client, but the runtime behavior of `refresh()` and `build_oidc_client()` must remain identical. All existing tests pass unchanged.
- **Deterministic time.** Tests inject a `Clock` trait implementation that returns controlled timestamps. No real sleeps, no flaky timing. The production `Clock` impl is a zero-cost wrapper around `chrono::Utc::now()`.
- **Endpoint override, not HTTP interception.** The mock server is a real HTTP server (via `wiremock`). The AWS SDK's endpoint override mechanism routes requests to it. This tests the actual SDK serialization/deserialization path.
- **Isolated config directory.** Every test uses `tempfile::TempDir` as `GS_ASSUME_CONFIG_DIR` so tests don't interfere with each other or the host machine.
- **No new binary dependencies.** The Dockerfile uses the existing Rust toolchain. `wiremock` and `tokio-test` are dev-dependencies only.
- **Existing 52+ tests remain green.** The trait extraction must be backward-compatible; `AwsProvider::refresh()` delegates to the same logic path.

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: An OidcTokenClient trait and a Clock trait exist that abstract the
         AWS OIDC CreateToken call and wall-clock time respectively. The
         production implementations wrap the real aws-sdk-ssooidc Client and
         chrono::Utc::now(). The refresh() function accepts any implementors
         of these traits instead of constructing them internally.
         AwsProvider::refresh() continues to work identically by using the
         production implementations.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"trait_abstraction_compiles"
  verify: cd packages/assume && cargo test trait_abstraction_compiles --test daemon_refresh

- [x] id: a2
  intent: A wiremock-based mock OIDC server can simulate the CreateToken
         (refresh_token grant) endpoint, returning configurable access tokens,
         optional new refresh tokens, and configurable expires_in values.
         Error responses (expired token, invalid grant, network timeout) are
         also configurable per-test.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"mock_server_returns_fresh_access_token"
    - packages/assume/tests/daemon_refresh.rs::"mock_server_returns_expired_token_error"
  verify: cd packages/assume && cargo test mock_server --test daemon_refresh

- [x] id: a3
  intent: Baseline scenario — after a simulated login (tokens written to vault),
         calling refresh() with a valid refresh token returns new tokens with
         updated session_expires_at. The vault is updated with the new tokens.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"baseline_refresh_updates_session_expiry"
  verify: cd packages/assume && cargo test baseline_refresh --test daemon_refresh

- [x] id: a4
  intent: Daemon persistence scenario — the refresh loop (run_refresh_loop)
         detects an expiring session token and silently refreshes it without
         user interaction. After time advances past the refresh buffer, the
         daemon calls refresh and updates stored tokens.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"daemon_loop_refreshes_before_expiry"
  verify: cd packages/assume && cargo test daemon_loop_refreshes --test daemon_refresh

- [x] id: a5
  intent: Token rotation scenario — when the mock returns a new refresh_token
         in the CreateToken response, the vault is updated with the new refresh
         token and refresh_expires_at is extended by 7 days from now.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"token_rotation_extends_refresh_expiry"
  verify: cd packages/assume && cargo test token_rotation --test daemon_refresh

- [x] id: a6
  intent: Refresh token expiry scenario — when time advances past
         refresh_expires_at, the refresh function returns RefreshTokenExpired
         and the daemon marks the provider status as NeedsLogin.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"expired_refresh_token_triggers_needs_login"
  verify: cd packages/assume && cargo test expired_refresh_token --test daemon_refresh

- [x] id: a7
  intent: Daemon crash/recovery scenario — tokens are persisted to vault,
         daemon state is destroyed and reconstructed from vault, and the
         refresh loop resumes successfully using the recovered tokens.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"crash_recovery_resumes_refresh"
  verify: cd packages/assume && cargo test crash_recovery --test daemon_refresh

- [x] id: a8
  intent: A Dockerfile exists that builds the test binary and runs the full
         daemon_refresh test suite in an isolated container. CI can invoke
         this without any AWS credentials or host-machine side effects.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"all tests pass in cargo test"
  verify: cd packages/assume && cargo test --test daemon_refresh

- [x] id: a9
  intent: When the OIDC client registration has expired (server returns
         InvalidClientException), refresh_with returns ProviderError::Other
         with a message instructing the user to re-login. This is distinct
         from RefreshTokenExpired — the refresh token may still be valid but
         the client registration (which has its own TTL) has expired.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"client_registration_expired_triggers_reauth"
  verify: cd packages/assume && cargo test client_registration_expired --test daemon_refresh

- [x] id: a10
  intent: After daemon death, restarting the daemon loads tokens from vault,
         determines status=Active (because refresh_expires_at > now), and the
         first refresh tick succeeds using the recovered tokens. Validates the
         DaemonState::new() initialization path.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"daemon_dies_and_recovers_with_valid_refresh_token"
  verify: cd packages/assume && cargo test daemon_dies_and_recovers --test daemon_refresh

- [x] id: a11
  intent: Worst-case recovery: daemon was dead long enough that the session
         token expired, but the refresh token is still valid. On restart the
         daemon sets Active, detects expired session, refreshes successfully,
         and returns to normal operation without browser interaction.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"daemon_dies_session_expired_but_refresh_valid_recovers"
  verify: cd packages/assume && cargo test daemon_dies_session_expired --test daemon_refresh
```

## File-level changes

### `packages/assume/src/providers/aws/oidc_client.rs` (NEW)
- Change: Define `OidcTokenClient` trait with a single async method `create_token_refresh(client_id, client_secret, refresh_token) -> Result<CreateTokenOutput, SdkError>`. Implement `RealOidcClient` that wraps `aws_sdk_ssooidc::Client` and delegates to the real SDK.
- Why: Enables injecting a mock implementation in tests without changing the refresh logic itself.
- Risk: low

### `packages/assume/src/providers/aws/clock.rs` (NEW)
- Change: Define a `Clock` trait with `fn now(&self) -> DateTime<Utc>`. Implement `SystemClock` (returns `Utc::now()`). In tests, `MockClock` wraps an `Arc<AtomicI64>` of milliseconds that tests can advance freely.
- Why: `chrono::Utc::now()` is not controlled by tokio time. Without this, tests would need real sleeps and become flaky. The `SystemClock` impl is zero-cost (inlined).
- Risk: low

### `packages/assume/src/providers/aws/refresh.rs`
- Change: Make `refresh()` generic over `OidcTokenClient` and `Clock`. Replace the bare `Utc::now()` call (line 40) with `clock.now()`. Add a second entry point `refresh_with(client, clock)` that accepts any `impl OidcTokenClient + impl Clock`. The existing `refresh()` function calls `refresh_with(RealOidcClient::new(region), SystemClock)` to preserve the public API.
- Why: Tests can call `refresh_with(mock_client, mock_clock)` directly without needing a real AWS endpoint or real time passage.
- Risk: low

### `packages/assume/src/providers/aws/mod.rs`
- Change: Add `pub mod oidc_client;` and `pub mod clock;` to the module declarations. Expose `refresh_with` for test use via `pub(crate)`.
- Why: Module wiring for the new trait files.
- Risk: none

### `packages/assume/Cargo.toml`
- Change: Add dev-dependencies: `wiremock = "0.6"`, `tokio-test = "0.4"`, `serde_urlencoded = "0.7"` (for parsing mock request bodies).
- Why: wiremock provides the mock HTTP server; tokio-test provides `tokio::time::pause()` utilities; serde_urlencoded parses form-encoded OIDC requests.
- Risk: none

### `packages/assume/tests/daemon_refresh.rs` (NEW)
- Change: New integration test file containing all 6 scenario tests plus the trait compilation smoke test. Uses `wiremock::MockServer` with custom matchers for the OIDC CreateToken endpoint. Uses `MockClock` for deterministic time advancement. Each test creates a `tempfile::TempDir`, sets `GS_ASSUME_CONFIG_DIR`, writes initial tokens to vault, and exercises the refresh path.
- Why: This is the core test harness — exercises the full daemon refresh lifecycle with deterministic time control.
- Risk: medium (largest new file; most complex test setup)

### `packages/assume/tests/helpers/mod.rs` (NEW)
- Change: Shared test utilities: `MockOidcServer` (wraps wiremock with OIDC-specific response builders), `TestVault` (creates temp config dir with pre-seeded tokens), `make_test_tokens()` (factory for `AuthTokens` with configurable expiry times).
- Why: DRY across the 7+ test functions; keeps individual tests focused on the scenario logic.
- Risk: low

### `packages/assume/Cargo.lock`
- Change: Auto-updated by Cargo when dev-dependencies (wiremock, tokio-test, serde_urlencoded) are added.
- Why: Lockfile tracks exact resolved versions of new dev-dependencies.
- Risk: none

### `packages/assume/Dockerfile.test` (NEW)
- Change: Multi-stage Dockerfile. Stage 1: `rust:1.75-slim` base, copies `Cargo.toml` + `Cargo.lock` + `src/` + `tests/`, runs `cargo test --test daemon_refresh --no-run` to cache deps. Stage 2: runs `cargo test --test daemon_refresh`. No AWS credentials needed.
- Why: Provides the containerized isolation the user requested. CI can run `docker build -f Dockerfile.test .` with zero host-machine side effects.
- Risk: low

## Test plan

- **Unit-level:** `trait_abstraction_compiles` verifies the trait + real impl compile and the existing `refresh()` function signature is unchanged.
- **Integration-level:** 6 scenario tests (a3–a8) each spin up a wiremock server, configure responses, create a temp vault, and exercise the refresh path with time manipulation.
- **Container-level:** `Dockerfile.test` runs the full suite in isolation. Can be added to CI as a GitHub Actions step.
- **Regression:** Existing `tests/integration.rs` and `tests/conformance.rs` must continue to pass — verified by `cargo test` (all tests).

## Out of scope

- **GCP provider testing.** This plan covers AWS OIDC only. GCP refresh testing follows the same pattern but is a separate effort.
- **Full device-code login flow mocking.** We mock only the refresh grant (`CreateToken` with `grant_type=refresh_token`). The initial login flow (RegisterClient, StartDeviceAuthorization, device-code CreateToken) is not tested here.
- **ListAccounts / ListAccountRoles / GetRoleCredentials mocking.** Credential fetch is out of scope; we test only the token refresh path.
- **Root-cause fix for the 1-2x/day login bug.** This harness is diagnostic infrastructure. If the tests reveal the bug, the fix is a follow-up.
- **CI pipeline integration.** The Dockerfile is provided but wiring it into `.github/workflows/` is a follow-up.

## Open questions

- **AWS SDK endpoint override mechanism:** The AWS Rust SDK supports `endpoint_url()` on the config builder. Need to verify this works with `aws-sdk-ssooidc` v1 specifically — if not, the alternative is to construct the SDK client with a custom `HttpConnector`. (Checked: `aws_sdk_ssooidc::config::Builder::endpoint_url()` exists in v1.)
- **`tokio::time::pause()` interaction with wiremock:** wiremock spawns its own tokio runtime internally. Need to confirm that pausing time in the test's runtime doesn't freeze wiremock's accept loop. Mitigation: wiremock uses `tokio::spawn` on the same runtime, so `pause()` should work since `advance()` drives all tasks. If not, the fallback is to not pause tokio time and rely solely on the `MockClock` for time control (which is independent of tokio's time driver).
- **Daemon refresh loop clock injection:** The `run_refresh_loop` in `daemon.rs` also calls `Utc::now()` (line 353). For the daemon-level tests (a4, a6, a7), we either need to inject the Clock into the daemon loop as well, or test at the `refresh_provider` level with a mock provider that uses our Clock. The latter is simpler — create a `MockProvider` implementing the `Provider` trait that delegates refresh to `refresh_with(mock_client, mock_clock)`.
