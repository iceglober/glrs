#!/usr/bin/env bash
# Verify command for autoresearch loop.
# Runs enrichment eval and outputs the composite score.
# Exit 0 = success (score is printed to stdout as JSON).
# Exit 1 = eval infrastructure failure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Run tests first as a guard — if tests fail, the optimization broke something
cd "$REPO_ROOT"
bun test packages/autopilot/ --timeout 30000 2>/dev/null || {
  echo '{"score": 0, "error": "tests failed"}'
  exit 0
}

# Run the eval
cd "$REPO_ROOT"
bun run packages/autopilot/eval/run-eval.ts
