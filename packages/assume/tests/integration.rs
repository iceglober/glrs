//! Integration tests for glrs-assume CLI.
//! These test the CLI binary itself via assert_cmd.

use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;

/// Build a Command for glrs-assume with GLRS_CLI_DISPATCHED=1 pre-set.
/// All pre-existing tests use this helper so they continue to work after
/// the standalone-redirect guard was added to main().
fn glrs_assume() -> Command {
    let mut cmd = Command::cargo_bin("glrs-assume").unwrap();
    cmd.env("GLRS_CLI_DISPATCHED", "1");
    cmd
}

/// A glrs-assume Command bound to a fresh, already-initialized config dir.
/// Use for commands that the init gate would otherwise block. The returned
/// `TempDir` must be kept alive for the command's lifetime (drop deletes it).
fn glrs_assume_initialized() -> (Command, TempDir) {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("initialized.json"), "{}\n").unwrap();
    let mut cmd = glrs_assume();
    cmd.env("GLRS_ASSUME_CONFIG_DIR", dir.path());
    (cmd, dir)
}

/// Write a minimal AWS default context into a config dir's `defaults/` so
/// shell-init emits the AWS ambient env (it's gated on the provider having a
/// default — see `cli::shell_init::run`).
fn write_aws_default(dir: &std::path::Path) {
    let defaults = dir.join("defaults");
    std::fs::create_dir_all(&defaults).unwrap();
    std::fs::write(
        defaults.join("aws.json"),
        r#"{"provider_id":"aws","id":"acct/role","display_name":"dev","searchable_fields":[],"tags":[],"metadata":{},"region":"us-east-1"}"#,
    )
    .unwrap();
}

/// An initialized config dir that already has an AWS default, so shell-init
/// exports the AWS credential endpoint env. Keep the `TempDir` alive.
fn glrs_assume_with_aws_default() -> (Command, TempDir) {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("initialized.json"), "{}\n").unwrap();
    write_aws_default(dir.path());
    let mut cmd = glrs_assume();
    cmd.env("GLRS_ASSUME_CONFIG_DIR", dir.path());
    (cmd, dir)
}

#[test]
fn test_version() {
    glrs_assume()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("glrs-assume"));
}

#[test]
fn test_help() {
    glrs_assume()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Unified credential assume manager",
        ));
}

#[test]
fn test_login_help() {
    glrs_assume()
        .args(["login", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Authenticate"));
}

#[test]
fn test_status_no_auth() {
    // Status should work even with no authentication
    glrs_assume().arg("status").assert().success();
}

#[test]
fn test_contexts_no_auth() {
    // Runs in an initialized config dir so the init gate doesn't block it —
    // this test is about contexts tolerating no auth, not the gate.
    let (mut cmd, _dir) = glrs_assume_initialized();
    cmd.arg("contexts").assert().success();
}

#[test]
fn test_shell_init_bash() {
    glrs_assume()
        .args(["shell-init", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::contains("export"));
}

#[test]
fn test_shell_init_zsh() {
    glrs_assume()
        .args(["shell-init", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::contains("export"));
}

#[test]
fn test_shell_init_fish() {
    glrs_assume()
        .args(["shell-init", "fish"])
        .assert()
        .success()
        .stdout(predicate::str::contains("set -gx"));
}

#[test]
fn test_shell_init_invalid() {
    glrs_assume()
        .args(["shell-init", "powershell"])
        .assert()
        .failure();
}

#[test]
fn test_logout_no_auth() {
    // Logout should succeed even with nothing to logout from. Initialized dir
    // so the gate doesn't block the gated `logout` command.
    let (mut cmd, _dir) = glrs_assume_initialized();
    cmd.args(["logout", "aws"]).assert().success();
}

#[test]
fn test_exec_no_args() {
    glrs_assume().arg("exec").assert().failure();
}

// -- Shell wrapper safety tests --

#[test]
fn test_use_help_does_not_output_export() {
    // `gsa use --help` should NOT output export lines (the shell wrapper evals stdout)
    let output = glrs_assume().args(["use", "--help"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        !stdout.contains("export "),
        "use --help must not output export lines that would be eval'd by the shell wrapper"
    );
}

#[test]
fn test_shell_init_contains_bearer_token() {
    // shell-init must set AWS_CONTAINER_AUTHORIZATION_TOKEN for credential auth
    // (with an AWS default present — ambient env is gated on having one).
    let (mut cmd, _dir) = glrs_assume_with_aws_default();
    cmd.args(["shell-init", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "AWS_CONTAINER_AUTHORIZATION_TOKEN",
        ))
        .stdout(predicate::str::contains(
            "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        ));
}

#[test]
fn test_shell_init_zsh_prompt_uses_zero_width_markers() {
    // ANSI codes in prompts must be wrapped in %{...%} for zsh
    let output = glrs_assume().args(["shell-init", "zsh"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        stdout.contains("%{") && stdout.contains("%}"),
        "zsh prompt must use %{{...%}} zero-width markers around ANSI codes"
    );
}

#[test]
fn test_shell_init_bash_prompt_uses_zero_width_markers() {
    // ANSI codes in prompts must be wrapped in \[...\] for bash
    let output = glrs_assume()
        .args(["shell-init", "bash"])
        .assert()
        .success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        stdout.contains("\\[") && stdout.contains("\\]"),
        "bash prompt must use \\[...\\] zero-width markers around ANSI codes"
    );
}

#[test]
fn test_shell_init_wrapper_only_evals_exports() {
    // The shell wrapper should check for 'export ' before evaling
    let output = glrs_assume().args(["shell-init", "zsh"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        stdout.contains(r#"*"export "*"#),
        "shell wrapper must check for 'export ' before evaling output"
    );
}

#[test]
fn test_session_token_is_persistent() {
    // Two invocations of shell-init should produce the same session token.
    // Both share one config dir (with an AWS default so the token is emitted).
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("initialized.json"), "{}\n").unwrap();
    write_aws_default(dir.path());

    let output1 = glrs_assume()
        .env("GLRS_ASSUME_CONFIG_DIR", dir.path())
        .args(["shell-init", "zsh"])
        .output()
        .unwrap();
    let stdout1 = String::from_utf8_lossy(&output1.stdout);

    let output2 = glrs_assume()
        .env("GLRS_ASSUME_CONFIG_DIR", dir.path())
        .args(["shell-init", "zsh"])
        .output()
        .unwrap();
    let stdout2 = String::from_utf8_lossy(&output2.stdout);

    // Extract the token value from both outputs
    let extract_token = |s: &str| -> Option<String> {
        s.lines()
            .find(|l| l.contains("AWS_CONTAINER_AUTHORIZATION_TOKEN"))
            .and_then(|l| l.split('"').nth(1))
            .map(|t| t.to_string())
    };

    let token1 = extract_token(&stdout1).expect("first invocation should output token");
    let token2 = extract_token(&stdout2).expect("second invocation should output token");
    assert_eq!(
        token1, token2,
        "session token must be persistent across invocations (daemon and shell-init must agree)"
    );
}

#[test]
fn test_shell_init_bearer_prefix() {
    // AWS_CONTAINER_AUTHORIZATION_TOKEN must include Bearer prefix
    // because AWS SDKs send this value as-is in the Authorization header
    let (mut cmd, _dir) = glrs_assume_with_aws_default();
    let output = cmd.args(["shell-init", "zsh"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let token_line = stdout
        .lines()
        .find(|l| l.contains("AWS_CONTAINER_AUTHORIZATION_TOKEN"))
        .expect("must have token line");
    assert!(
        token_line.contains("Bearer "),
        "AWS_CONTAINER_AUTHORIZATION_TOKEN must include 'Bearer ' prefix for AWS SDK compatibility, got: {token_line}"
    );
}

#[test]
fn test_shell_init_and_use_share_same_credential_uri_base() {
    // shell-init outputs the base credential URI
    // gsa use should output an updated URI with context ID appended
    let (mut cmd, _dir) = glrs_assume_with_aws_default();
    let output = cmd.args(["shell-init", "zsh"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Must contain the base URI
    assert!(
        stdout.contains("http://localhost:9911/credentials"),
        "shell-init must set AWS_CONTAINER_CREDENTIALS_FULL_URI to credential endpoint"
    );

    // The base URI should NOT contain a context ID (that comes from `use`)
    let uri_line = stdout
        .lines()
        .find(|l| l.contains("AWS_CONTAINER_CREDENTIALS_FULL_URI"))
        .expect("must have URI line");
    assert!(
        uri_line.contains("http://localhost:9911/credentials\""),
        "shell-init URI should be the base path without context ID, got: {uri_line}"
    );
}

#[test]
fn test_use_outputs_credential_uri_with_context_id() {
    // When `gsa use` succeeds (with a real context), it should output
    // AWS_CONTAINER_CREDENTIALS_FULL_URI with the context ID in the path.
    // We can't test with a real context in CI, but we CAN verify that
    // when use fails (no contexts), it doesn't output export lines.
    let output = glrs_assume()
        .args(["use", "nonexistent-context-12345"])
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Failed use should NOT output export lines
    assert!(
        !stdout.contains("export "),
        "failed `use` must not output export lines, got: {stdout}"
    );
}

// ── Standalone nudge tests ───────────────────────────────────────────────────

/// glrs-assume prints a migration nudge when GLRS_CLI_DISPATCHED is unset,
/// but still runs the command successfully.
#[test]
fn test_nudge_when_not_dispatched() {
    Command::cargo_bin("glrs-assume")
        .unwrap()
        .env_remove("GLRS_CLI_DISPATCHED")
        .arg("--version")
        .assert()
        .success()
        .stderr(predicate::str::contains("npm i -g @glrs-dev/assume"));
}

/// gsa prints a migration nudge when GLRS_CLI_DISPATCHED is unset.
#[test]
fn test_gsa_nudge_when_not_dispatched() {
    Command::cargo_bin("gsa")
        .unwrap()
        .env_remove("GLRS_CLI_DISPATCHED")
        .arg("--version")
        .assert()
        .success()
        .stderr(predicate::str::contains("npm i -g @glrs-dev/assume"));
}

/// glrs-assume suppresses the nudge when GLRS_CLI_DISPATCHED=1.
#[test]
fn test_no_nudge_when_dispatched() {
    Command::cargo_bin("glrs-assume")
        .unwrap()
        .env("GLRS_CLI_DISPATCHED", "1")
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("glrs-assume"))
        .stderr(predicate::str::contains("npm i -g").not());
}

// ── Shell-init stdout safety ────────────────────────────────────────────────

/// shell-init's stdout MUST contain only valid shell code, nothing else.
/// BackgroundEnsure calls spawn_daemon_if_dead() which could theoretically
/// leak output. If anything non-shell lands in stdout, `eval "$(glrs-assume
/// shell-init zsh)"` will error and break the user's terminal.
#[test]
fn test_shell_init_stdout_is_clean_shell_code() {
    let output = glrs_assume().args(["shell-init", "zsh"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Every non-empty, non-comment line should be valid shell syntax:
    // export, function, if, fi, echo, set, etc. — not tracing output or errors.
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // Tracing output looks like: "2024-01-01T00:00:00Z INFO ..."
        // or "  at src/core/daemon.rs:123"
        assert!(
            !trimmed.contains(" INFO ")
                && !trimmed.contains(" WARN ")
                && !trimmed.contains(" ERROR ")
                && !trimmed.starts_with("at "),
            "shell-init stdout contains tracing/log output which would corrupt eval: {trimmed}"
        );
    }
}

// ── Init gate tests ──────────────────────────────────────────────────────────

/// Before `gsa init`, a gated command refuses and points the user at `gsa init`.
#[test]
fn test_gate_blocks_command_before_init() {
    let dir = TempDir::new().unwrap();
    glrs_assume()
        .env("GLRS_ASSUME_CONFIG_DIR", dir.path())
        .arg("contexts")
        .assert()
        .failure()
        .stderr(predicate::str::contains("gsa init"));
}

/// `gsa exec` (an agent-facing command) is also gated before init.
#[test]
fn test_gate_blocks_exec_before_init() {
    let dir = TempDir::new().unwrap();
    glrs_assume()
        .env("GLRS_ASSUME_CONFIG_DIR", dir.path())
        .args(["exec", "--", "true"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("gsa init"));
}

/// Allowlisted commands (here `config`) run before init — no gate message.
#[test]
fn test_gate_allows_config_before_init() {
    let dir = TempDir::new().unwrap();
    glrs_assume()
        .env("GLRS_ASSUME_CONFIG_DIR", dir.path())
        .args(["config", "get", "providers.aws.start_url"])
        .assert()
        .stderr(predicate::str::contains("gsa init").not());
}

/// Once the init marker exists, gated commands clear the gate.
#[test]
fn test_gate_passes_after_marker() {
    let (mut cmd, _dir) = glrs_assume_initialized();
    cmd.arg("contexts")
        .assert()
        .stderr(predicate::str::contains("gsa init").not());
}

/// shell-init for all shells should produce parseable output, not crash.
#[test]
fn test_shell_init_all_shells_succeed() {
    for shell in &["bash", "zsh", "fish"] {
        let output = glrs_assume().args(["shell-init", shell]).output().unwrap();
        assert!(
            output.status.success(),
            "shell-init {shell} failed with status {}",
            output.status
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            !stdout.is_empty(),
            "shell-init {shell} produced empty stdout"
        );
    }
}
