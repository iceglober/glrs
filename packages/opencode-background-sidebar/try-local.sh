#!/usr/bin/env bash
#
# Isolated local test for the background-jobs sidebar spike.
#
# TUI plugins are NOT loaded via opencode.json's `plugin` array (that's server
# plugins). They install into a separate `.opencode/tui.json` registry via
# `opencode plugin <path>`, which detects the `./tui` export. This script does
# that in a throwaway project, so nothing touches your real setup.
#
# - Installs the plugin LOCALLY into a sandbox project's .opencode/tui.json.
# - Isolates XDG_STATE_HOME so seeded demo jobs / session state stay separate.
# - Seeds 3 fake jobs so the sidebar has content immediately.
# - Cleans everything up when you quit opencode.
#
# Usage:  bash examples/tui-background-sidebar/try-local.sh
#
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SANDBOX="$(mktemp -d)"
export XDG_STATE_HOME="$SANDBOX/state"   # isolates seeded jobs + this session's state
PROJECT="$SANDBOX/project"
mkdir -p "$PROJECT"
cd "$PROJECT"

echo "==> Resolving the spike's deps (so opencode can package it)…"
( cd "$SPIKE_DIR" && bun install )

echo "==> Installing the sidebar plugin into this sandbox project (.opencode/tui.json)…"
# Local scope (no --global): writes to ./.opencode/tui.json. opencode detects
# the ./tui export, packages the plugin, and loads it as a TUI plugin.
opencode plugin "$SPIKE_DIR"

# Seed fake jobs where the sidebar reads them.
JOBS="$XDG_STATE_HOME/harness-opencode/background-jobs"
mkdir -p "$JOBS"
NOW_MS=$(( $(date +%s) * 1000 ))
meta() { printf '{"id":"%s","command":"%s","withGsa":null,"cwd":".","pid":%s,"startedAt":%s}' "$1" "$2" "$3" "$NOW_MS"; }

# 1) running — uses THIS script's pid ($$), alive as long as opencode runs.
mkdir -p "$JOBS/bg-demo-running"
meta "bg-demo-running" "pnpm test --watch" "$$" > "$JOBS/bg-demo-running/meta.json"
# 2) finished, exit 0 (green)
mkdir -p "$JOBS/bg-demo-ok"
meta "bg-demo-ok" "./backfill.sh" 999999 > "$JOBS/bg-demo-ok/meta.json"
printf '0' > "$JOBS/bg-demo-ok/exit_code"
# 3) finished, exit 2 (red)
mkdir -p "$JOBS/bg-demo-fail"
meta "bg-demo-fail" "./migrate.sh" 999998 > "$JOBS/bg-demo-fail/meta.json"
printf '2' > "$JOBS/bg-demo-fail/exit_code"

cleanup() { rm -rf "$SANDBOX"; echo "==> Cleaned up sandbox ($SANDBOX)."; }
trap cleanup EXIT INT TERM

cat <<MSG

==> Launching opencode in the sandbox. Your real config/state are untouched.
    You should first see toasts: "bg-sidebar: tui ran…" then, once you open a
    session, "bg-sidebar: slot invoked (3 jobs)".
    Then in the SIDEBAR (inside a session), a "background jobs" section:
        running   demo-running   pnpm test --watch     (blue)
        exit 0    demo-ok        ./backfill.sh         (green)
        exit 2    demo-fail      ./migrate.sh          (red)
    Refreshes every 2s. Quit opencode to tear down.

    Debug log (if it misbehaves): newest file in ~/.local/share/opencode/log/
MSG

opencode || true
