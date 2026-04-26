#!/usr/bin/env bash
# Behavior tests for home/.config/opencode/bin/memory-mcp-launcher.sh.
#
# Each case uses MEMORY_MCP_LAUNCHER_PRINT_AND_EXIT=1 so the launcher resolves
# the path, prints it to stderr, and exits 0 before calling `npx`. No real MCP
# server is launched. Tests run in isolated temp dirs and set HOME to a scratch
# location so the fallback path check can assert cleanly.
#
# Usage: bash test/memory-mcp-launcher.sh
# Exit: 0 all pass; 1 on first failure.

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
LAUNCHER="$REPO_ROOT/home/.config/opencode/bin/memory-mcp-launcher.sh"

if [[ ! -f "$LAUNCHER" ]]; then
  echo "FAIL: launcher not found at $LAUNCHER" >&2
  exit 1
fi

c_reset=$'\033[0m'; c_green=$'\033[32m'; c_red=$'\033[31m'; c_bold=$'\033[1m'

pass_count=0
fail_count=0

TMPROOT="$(mktemp -d)"
# Cleanup: the temp dirs contain git repos + tracked state; rm -rf is banned,
# so use find -delete which is slower but safe.
trap 'find "$TMPROOT" -mindepth 1 -delete 2>/dev/null || true; rmdir "$TMPROOT" 2>/dev/null || true' EXIT

_fail() {
  printf "%s✗ FAIL%s %s: %s\n" "$c_red" "$c_reset" "$CASE" "$1" >&2
  fail_count=$((fail_count + 1))
}
_pass() {
  printf "%s✓ PASS%s %s\n" "$c_green" "$c_reset" "$CASE"
  pass_count=$((pass_count + 1))
}

# Resolve an absolute path to bash so tests can use a minimal PATH without
# losing the interpreter itself.
BASH_ABS="$(command -v bash)"

# Run the launcher with PRINT_AND_EXIT, capturing stderr + stdout separately.
# Args passed as env + cwd; returns the resolved path via stderr's last line.
#
# Usage: _run_launcher <cwd> [extra env vars "KEY=VAL ..."]
# Sets globals: RESOLVED_PATH, STDOUT_FILE, STDERR_FILE, EXIT_CODE
_run_launcher() {
  local cwd="$1"; shift
  local workdir="$TMPROOT/$CASE"
  mkdir -p "$workdir"
  STDOUT_FILE="$workdir/stdout.txt"
  STDERR_FILE="$workdir/stderr.txt"
  : > "$STDOUT_FILE"
  : > "$STDERR_FILE"
  EXIT_CODE=0
  (
    cd "$cwd"
    # shellcheck disable=SC2068  # intentionally unsplit env assignments
    env MEMORY_MCP_LAUNCHER_PRINT_AND_EXIT=1 $@ "$BASH_ABS" "$LAUNCHER"
  ) > "$STDOUT_FILE" 2> "$STDERR_FILE" || EXIT_CODE=$?
  # Last stderr line is the resolved path (PRINT_AND_EXIT format).
  RESOLVED_PATH="$(tail -n1 "$STDERR_FILE" 2>/dev/null || printf "")"
}

# Assert stdout is empty (MCP stdio invariant).
_assert_stdout_empty() {
  if [[ -s "$STDOUT_FILE" ]]; then
    _fail "stdout was non-empty (MCP stdio invariant violated):"
    sed 's/^/    /' "$STDOUT_FILE" >&2
    return 1
  fi
  return 0
}

_assert_exit_0() {
  if [[ "$EXIT_CODE" != "0" ]]; then
    _fail "expected exit 0, got $EXIT_CODE. stderr:"
    sed 's/^/    /' "$STDERR_FILE" >&2
    return 1
  fi
  return 0
}

# -------- case (a): normal clone --------
CASE="a-normal-clone"
(
  repo="$TMPROOT/$CASE/repo"
  mkdir -p "$repo"
  cd "$repo"
  git init -q .
  git commit --allow-empty -m init -q 2>/dev/null || true
)
_run_launcher "$TMPROOT/$CASE/repo" "HOME=$TMPROOT/$CASE/home"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
# Canonicalize via pwd -P to handle /tmp -> /private/tmp on macOS.
expected_path="$(cd "$TMPROOT/$CASE/repo" && pwd -P)/.agent/memory.json"
if [[ "$RESOLVED_PATH" != "$expected_path" ]]; then
  _fail "expected path '$expected_path', got '$RESOLVED_PATH'"
elif [[ ! -f "$TMPROOT/$CASE/repo/.agent/.gitignore" ]]; then
  _fail ".agent/.gitignore was not created"
elif [[ "$(cat "$TMPROOT/$CASE/repo/.agent/.gitignore")" != "memory.json" ]]; then
  _fail ".agent/.gitignore content mismatch: '$(cat "$TMPROOT/$CASE/repo/.agent/.gitignore")'"
else
  _pass
fi

# -------- case (b): worktree shares with main --------
CASE="b-worktree-shares"
(
  main="$TMPROOT/$CASE/main"
  mkdir -p "$main"
  cd "$main"
  git init -q .
  git commit --allow-empty -m init -q 2>/dev/null || true
  git worktree add -q "$TMPROOT/$CASE/wt" -b wt-branch 2>/dev/null
)
_run_launcher "$TMPROOT/$CASE/wt" "HOME=$TMPROOT/$CASE/home"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
expected_main="$(cd "$TMPROOT/$CASE/main" && pwd -P)/.agent/memory.json"
if [[ "$RESOLVED_PATH" != "$expected_main" ]]; then
  _fail "expected main-repo path '$expected_main' (worktree should share), got '$RESOLVED_PATH'"
else
  _pass
fi

# -------- case (c): outside git --------
CASE="c-outside-git"
(
  mkdir -p "$TMPROOT/$CASE/not-a-repo"
)
_run_launcher "$TMPROOT/$CASE/not-a-repo" "HOME=$TMPROOT/$CASE/home"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
expected_fallback="$TMPROOT/$CASE/home/.config/opencode/memory/fallback.json"
if [[ "$RESOLVED_PATH" != "$expected_fallback" ]]; then
  _fail "expected fallback '$expected_fallback', got '$RESOLVED_PATH'"
else
  _pass
fi

# -------- case (d): git missing on PATH --------
# On macOS, Apple ships git in /usr/bin, so stripping to /usr/bin:/bin would still
# find git. Use /bin only — it has mkdir/mv/rm (enough for the launcher's
# fallback path via bash parameter expansion) but no git.
CASE="d-git-missing"
(
  repo="$TMPROOT/$CASE/repo"
  mkdir -p "$repo"
  cd "$repo"
  git init -q .
)
_run_launcher "$TMPROOT/$CASE/repo" "HOME=$TMPROOT/$CASE/home" "PATH=/bin"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
expected_fallback="$TMPROOT/$CASE/home/.config/opencode/memory/fallback.json"
if [[ "$RESOLVED_PATH" != "$expected_fallback" ]]; then
  _fail "expected fallback (git missing) '$expected_fallback', got '$RESOLVED_PATH'"
else
  _pass
fi

# -------- case (e): bare repo --------
CASE="e-bare-repo"
(
  bare="$TMPROOT/$CASE/foo.git"
  mkdir -p "$bare"
  cd "$bare"
  git init -q --bare .
)
_run_launcher "$TMPROOT/$CASE/foo.git" "HOME=$TMPROOT/$CASE/home"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
expected_fallback="$TMPROOT/$CASE/home/.config/opencode/memory/fallback.json"
if [[ "$RESOLVED_PATH" != "$expected_fallback" ]]; then
  _fail "expected fallback (bare repo) '$expected_fallback', got '$RESOLVED_PATH'"
else
  _pass
fi

# -------- case (f): DEBUG=1 prints AND would exec (but we PRINT_AND_EXIT on top) --------
# Here we verify the DEBUG prefix shows up in stderr. PRINT_AND_EXIT still trumps
# and we exit before npx, but DEBUG should have already logged.
CASE="f-debug-mode"
(
  repo="$TMPROOT/$CASE/repo"
  mkdir -p "$repo"
  cd "$repo"
  git init -q .
)
_run_launcher "$TMPROOT/$CASE/repo" "HOME=$TMPROOT/$CASE/home" "MEMORY_MCP_LAUNCHER_DEBUG=1"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
if ! grep -q "^\[memory-mcp-launcher\] MEMORY_FILE_PATH=" "$STDERR_FILE"; then
  _fail "DEBUG=1 did not produce expected stderr log line. Actual stderr:"
  sed 's/^/    /' "$STDERR_FILE" >&2
else
  _pass
fi

# -------- case (g): existing .gitignore is not clobbered --------
CASE="g-existing-gitignore"
(
  repo="$TMPROOT/$CASE/repo"
  mkdir -p "$repo/.agent"
  cd "$repo"
  git init -q .
  printf "some-existing-rule\n" > "$repo/.agent/.gitignore"
)
_run_launcher "$TMPROOT/$CASE/repo" "HOME=$TMPROOT/$CASE/home"
_assert_exit_0 || { true; }
_assert_stdout_empty || { true; }
actual_gi="$(cat "$TMPROOT/$CASE/repo/.agent/.gitignore")"
if [[ "$actual_gi" != "some-existing-rule" ]]; then
  _fail "existing .gitignore was modified. Expected 'some-existing-rule', got: '$actual_gi'"
else
  _pass
fi

echo
if [[ $fail_count -eq 0 ]]; then
  printf "%s%sAll %d launcher cases passed.%s\n" "$c_green" "$c_bold" "$pass_count" "$c_reset"
  exit 0
fi
printf "%s%s%d/%d launcher cases failed.%s\n" "$c_red" "$c_bold" "$fail_count" "$((pass_count + fail_count))" "$c_reset" >&2
exit 1
