#!/usr/bin/env bash
# cascade-decomposition-eval.sh
#
# Evaluates PRIME prompt quality for cheap-tier cascading by checking
# whether the prompt contains the right decomposition guidance.
#
# Outputs a score (0-100). Higher is better.
# Each check is worth points. Presence of each rule in the prompt text
# adds to the score.
#
# Usage: bash eval/cascade-decomposition-eval.sh <prompt-file>

set -euo pipefail

PROMPT="${1:-packages/harness-opencode/src/agents/prompts/prime-ultra.md}"
score=0
total=0

check() {
  local points=$1
  local label=$2
  local pattern=$3
  total=$((total + points))
  if grep -qiP "$pattern" "$PROMPT" 2>/dev/null; then
    score=$((score + points))
    echo "  [+$points] $label"
  else
    echo "  [  0] $label (MISSING)"
  fi
}

echo "Evaluating: $PROMPT"
echo ""

# === Decomposition guidance (40 points) ===
echo "=== Decomposition guidance ==="
check 10 "Per-file subtask decomposition rule" "per.file|one.file.per.dispatch|atomic.subtask|single.file"
check 10 "Multi-package tasks must be split" "multi.package|cross.package|multiple.package|split.across.package"
check 10 "Example of decomposed dispatch" "add.*method.*model\.ts|create.*contract\.ts|add.*route.*router"
check 10 "Never send entire phase as one dispatch" "never.*entire.phase|do.not.*whole.phase|one.phase.per.dispatch|monolithic"

# === Skip-cheap criteria (25 points) ===
echo ""
echo "=== Skip-cheap criteria ==="
check 5 "Skip cheap for >10 files" "10.file"
check 5 "Skip cheap for multi-package" "multi.package.*skip|skip.*multi.package|span.*multiple.*package.*skip|skip.*span"
check 5 "Skip cheap for security/auth/crypto" "security|auth|crypto|billing"
check 5 "Skip cheap for high risk" "risk.*high|high.*risk"
check 5 "Skip cheap for expensive cascade-fail" "cascade.fail|downstream.*wave|expensive.*fail"

# === Dispatch shape (20 points) ===
echo ""
echo "=== Dispatch shape ==="
check 10 "Sequential dispatch for shared worktree" "sequential|one.at.a.time|serial.*dispatch|do.not.*parallel.*same.*worktree"
check 10 "Worktree isolation for parallel lanes" "worktree.*isolat|separate.*worktree|isolation.*per.lane|worktree.*per"

# === Escalation (15 points) ===
echo ""
echo "=== Escalation signals ==="
check 5 "Escalate on BLOCKED" "BLOCKED"
check 5 "Escalate on FAIL_SPEC" "FAIL_SPEC"
check 5 "Escalate on empty output" "empty.*output|near.empty"

echo ""
echo "Score: $score / $total"

# Output just the score for autoresearch verify
echo "$score"
