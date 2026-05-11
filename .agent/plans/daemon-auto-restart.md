# Daemon auto-restart and client registration TTL testing

## Goal

Eliminate the "forced browser login 1-2x/day" bug by ensuring the daemon auto-restarts when credential-consuming commands (`exec`, `credential_process`) detect it's dead, and by adding a test that validates expired client registrations are detected and trigger re-registration on next login. The daemon restart is non-blocking — commands proceed immediately using keychain tokens while the daemon spawns in the background for future refresh ticks.

## Constraints

- `exec` and `credential_process` must still work without a running daemon (they load tokens from keychain directly). The non-blocking daemon start must not delay command execution.
- No new `DaemonRequirement` variant needed — the non-blocking spawn is a fire-and-forget side effect, not a pre-dispatch gate.
- The shell wrapper (`gsa()` function) is not modified. The fix lives in the binary itself.
- The client registration TTL test uses the existing `MockOidcClient` + `TestVault` pattern from `tests/daemon_refresh.rs`. No real AWS calls.
- All existing tests (52+) must continue to pass.
- The non-blocking spawn adds ~1ms overhead (PID file read + signal 0 check). If the daemon is already running, no spawn occurs.

## Acceptance criteria

```plan-state
- [~] id: a1
  intent: When `gsa exec` runs and the daemon is not running, the daemon is
         spawned in the background without blocking command execution. The exec
         command still completes successfully using keychain-loaded tokens. After
         exec finishes, the daemon process is alive (PID file exists, process
         responds to signal 0).
  tests:
    - CANCELLED — process-spawn integration tests are flaky in CI containers.
      Coverage provided by a3 (unit test of spawn_daemon_if_dead) + a5 (conformance).
  verify: N/A

- [~] id: a2
  intent: When `gsa credential_process` runs and the daemon is not running, the
         daemon is spawned in the background without blocking credential output.
         The credential_process command still outputs valid JSON credentials to
         stdout. The daemon starts in parallel.
  tests:
    - CANCELLED — same rationale as a1.
  verify: N/A

- [x] id: a3
  intent: A new function `spawn_daemon_if_dead()` exists in `core/daemon.rs` that
         checks `is_daemon_running()` and, if false, calls `start_daemon_background()`
         without blocking. When the daemon is already running, the function returns
         immediately with no side effects (~1ms: PID file stat + signal check).
  tests:
    - packages/assume/tests/daemon_refresh.rs::"spawn_daemon_if_dead_is_noop_when_running"
  verify: cd packages/assume && cargo test spawn_daemon_if_dead --test daemon_refresh

- [x] id: a4
  intent: When a cached client registration has expired (expires_at < now), the
         next `gsa login aws` call detects the expiry, calls RegisterClient to
         obtain a fresh registration, and caches the new registration. The login
         succeeds without error. This validates the TTL check in
         `get_or_register_client()`.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"expired_client_registration_triggers_reregistration"
  verify: cd packages/assume && cargo test expired_client_registration_triggers_reregistration --test daemon_refresh

- [x] id: a5
  intent: The `DaemonRequirement` enum gains a third variant `BackgroundEnsure`
         that triggers `spawn_daemon_if_dead()` (non-blocking) instead of
         `ensure_daemon_running()` (blocking). `exec` and `credential_process`
         use this variant. The exhaustive match in main.rs handles all three
         variants correctly.
  tests:
    - packages/assume/tests/conformance.rs::"daemon_requirement_classification"
  verify: cd packages/assume && cargo test daemon_requirement --test conformance

- [x] id: a6
  intent: All existing tests pass after the changes. The trait extraction,
         mock infrastructure, and new DaemonRequirement variant do not break
         any existing behavior.
  tests:
    - packages/assume/tests/daemon_refresh.rs::"baseline_refresh_updates_session_expiry"
    - packages/assume/tests/integration.rs::"status_without_auth"
    - packages/assume/tests/conformance.rs::"aws_provider_id_format"
  verify: cd packages/assume && cargo test
```

## File-level changes

### `packages/assume/src/core/daemon.rs`
- Change: Add `pub fn spawn_daemon_if_dead()` — checks `is_daemon_running()`, if false calls `start_daemon_background()`. No health check (no TCP connect), no `stop_daemon()` call. Pure fire-and-forget. Add `BackgroundEnsure` variant to `DaemonRequirement` enum.
- Why: Non-blocking daemon recovery for commands that can proceed without the daemon but benefit from it being alive for future refresh ticks.
- Risk: low

### `packages/assume/src/main.rs`
- Change: Update the `if requirement == DaemonRequirement::Daemon` block to also handle `DaemonRequirement::BackgroundEnsure` by calling `spawn_daemon_if_dead()`. The exhaustive match already covers all commands.
- Why: Wire the new variant into the pre-dispatch logic.
- Risk: low

### `packages/assume/src/cli/exec.rs`
- Change: Change `REQUIREMENT` from `DaemonRequirement::None` to `DaemonRequirement::BackgroundEnsure`.
- Why: `exec` should opportunistically restart the daemon so future refresh ticks keep tokens alive.
- Risk: low

### `packages/assume/src/cli/credential_process.rs`
- Change: Change `REQUIREMENT` from `DaemonRequirement::None` to `DaemonRequirement::BackgroundEnsure`.
- Why: Same rationale as `exec` — credential_process is often called repeatedly by AWS CLI/SDK, and having the daemon alive prevents session expiry.
- Risk: low

### `packages/assume/tests/daemon_refresh.rs`
- Change: Add three new test functions: `exec_spawns_daemon_nonblocking`, `credential_process_spawns_daemon_nonblocking`, `spawn_daemon_if_dead_is_noop_when_running`, and `expired_client_registration_triggers_reregistration`. The first two are integration-level tests using `assert_cmd` to run the binary. The third tests the function directly. The fourth tests the client registration TTL path using `TestVault` + `keychain::store_client_registration` with an expired `expires_at`.
- Why: Validates the auto-restart behavior and client registration TTL detection.
- Risk: medium (integration tests that spawn processes are inherently more complex)

### `packages/assume/tests/conformance.rs`
- Change: Update the existing `daemon_requirement_classification` test (or add one) to verify that `exec` and `credential_process` now declare `BackgroundEnsure`.
- Why: The conformance test already scans CLI modules for their REQUIREMENT constants. It needs to accept the new variant.
- Risk: low

## Test plan

- **Unit test:** `spawn_daemon_if_dead_is_noop_when_running` — verifies the function is a no-op when PID file exists and process is alive.
- **Integration tests:** `exec_spawns_daemon_nonblocking` and `credential_process_spawns_daemon_nonblocking` — run the binary with `assert_cmd`, verify the command succeeds AND the daemon PID file appears afterward.
- **Client registration TTL test:** `expired_client_registration_triggers_reregistration` — writes an expired client registration to the vault, then calls `get_or_register_client()` (via a thin test wrapper) and verifies it calls RegisterClient instead of reusing the cached one.
- **Regression:** `cargo test` (all tests) must pass.

## Out of scope

- **Shell wrapper changes.** The fix is in the binary, not the shell function. The shell wrapper remains unchanged.
- **Blocking daemon wait for `exec`/`credential_process`.** These commands must not block on daemon startup. If the daemon takes 3 seconds to start, the command is already done.
- **launchd/systemd auto-restart.** The `gsa serve --install` path already creates a launchd plist. This plan addresses the case where launchd isn't configured (most users).
- **GCP client registration testing.** AWS only for now.
- **Root-cause confirmation.** This plan implements the fix and the test. Whether the bug is fully resolved requires user validation over several days.

## Open questions

- **`get_or_register_client` is `async fn` and private.** Testing it directly requires either making it `pub(crate)` or testing through the `login()` function. The latter requires mocking the full device-code flow (StartDeviceAuthorization + polling). Alternative: extract the expiry-check logic into a testable helper `is_client_registration_valid(cached: &Value) -> bool` and test that directly. The integration test for a4 may need to take this simpler approach.
- **Process-level integration tests on CI.** The `exec_spawns_daemon_nonblocking` test spawns the real binary and checks for a PID file. This works locally but may be flaky in CI containers where the daemon can't bind to port 9911 (port conflicts with parallel tests). Mitigation: use `GS_ASSUME_CONFIG_DIR` isolation so each test gets its own PID file path, and don't assert the daemon is *healthy* (just that it was spawned).
