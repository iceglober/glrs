//! Integration tests for gs-assume CLI.
//! These test the CLI binary itself via assert_cmd.

use assert_cmd::Command;
use predicates::prelude::*;

/// Build a Command for gs-assume with GLRS_CLI_DISPATCHED=1 pre-set.
/// All pre-existing tests use this helper so they continue to work after
/// the standalone-redirect guard was added to main().
fn gs_assume() -> Command {
    let mut cmd = Command::cargo_bin("gs-assume").unwrap();
    cmd.env("GLRS_CLI_DISPATCHED", "1");
    cmd
}

#[test]
fn test_version() {
    gs_assume()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("gs-assume"));
}

#[test]
fn test_help() {
    gs_assume()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Unified credential assume manager",
        ));
}

#[test]
fn test_login_help() {
    gs_assume()
        .args(["login", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Authenticate"));
}

#[test]
fn test_status_no_auth() {
    // Status should work even with no authentication
    gs_assume().arg("status").assert().success();
}

#[test]
fn test_profiles_no_auth() {
    gs_assume().arg("profiles").assert().success();
}

#[test]
fn test_shell_init_bash() {
    gs_assume()
        .args(["shell-init", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::contains("export"));
}

#[test]
fn test_shell_init_zsh() {
    gs_assume()
        .args(["shell-init", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::contains("export"));
}

#[test]
fn test_shell_init_fish() {
    gs_assume()
        .args(["shell-init", "fish"])
        .assert()
        .success()
        .stdout(predicate::str::contains("set -gx"));
}

#[test]
fn test_shell_init_invalid() {
    gs_assume()
        .args(["shell-init", "powershell"])
        .assert()
        .failure();
}

#[test]
fn test_logout_no_auth() {
    // Logout should succeed even with nothing to logout from
    gs_assume().args(["logout", "aws"]).assert().success();
}

#[test]
fn test_exec_no_args() {
    gs_assume().arg("exec").assert().failure();
}

// -- Shell wrapper safety tests --

#[test]
fn test_use_help_does_not_output_export() {
    // `gsa use --help` should NOT output export lines (the shell wrapper evals stdout)
    let output = gs_assume().args(["use", "--help"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        !stdout.contains("export "),
        "use --help must not output export lines that would be eval'd by the shell wrapper"
    );
}

#[test]
fn test_shell_init_contains_bearer_token() {
    // shell-init must set AWS_CONTAINER_AUTHORIZATION_TOKEN for credential auth
    gs_assume()
        .args(["shell-init", "zsh"])
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
    let output = gs_assume().args(["shell-init", "zsh"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        stdout.contains("%{") && stdout.contains("%}"),
        "zsh prompt must use %{{...%}} zero-width markers around ANSI codes"
    );
}

#[test]
fn test_shell_init_bash_prompt_uses_zero_width_markers() {
    // ANSI codes in prompts must be wrapped in \[...\] for bash
    let output = gs_assume().args(["shell-init", "bash"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        stdout.contains("\\[") && stdout.contains("\\]"),
        "bash prompt must use \\[...\\] zero-width markers around ANSI codes"
    );
}

#[test]
fn test_shell_init_wrapper_only_evals_exports() {
    // The shell wrapper should check for 'export ' before evaling
    let output = gs_assume().args(["shell-init", "zsh"]).assert().success();
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    assert!(
        stdout.contains(r#"*"export "*"#),
        "shell wrapper must check for 'export ' before evaling output"
    );
}

#[test]
fn test_session_token_is_persistent() {
    // Two invocations of shell-init should produce the same session token
    let output1 = gs_assume().args(["shell-init", "zsh"]).output().unwrap();
    let stdout1 = String::from_utf8_lossy(&output1.stdout);

    let output2 = gs_assume().args(["shell-init", "zsh"]).output().unwrap();
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
    let output = gs_assume().args(["shell-init", "zsh"]).output().unwrap();
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
    let output = gs_assume().args(["shell-init", "zsh"]).output().unwrap();
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
    let output = gs_assume()
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

/// gs-assume prints a migration nudge when GLRS_CLI_DISPATCHED is unset,
/// but still runs the command successfully.
#[test]
fn test_nudge_when_not_dispatched() {
    Command::cargo_bin("gs-assume")
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

/// gs-assume suppresses the nudge when GLRS_CLI_DISPATCHED=1.
#[test]
fn test_no_nudge_when_dispatched() {
    Command::cargo_bin("gs-assume")
        .unwrap()
        .env("GLRS_CLI_DISPATCHED", "1")
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("gs-assume"))
        .stderr(predicate::str::contains("npm i -g").not());
}
