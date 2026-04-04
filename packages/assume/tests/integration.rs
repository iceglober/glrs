//! Integration tests for gs-assume CLI.
//! These test the CLI binary itself via assert_cmd.

use assert_cmd::Command;
use predicates::prelude::*;

fn gs_assume() -> Command {
    Command::cargo_bin("gs-assume").unwrap()
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
