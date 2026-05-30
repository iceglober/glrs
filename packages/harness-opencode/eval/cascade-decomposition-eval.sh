#!/usr/bin/env bash
# cascade-decomposition-eval.sh
#
# Scores PRIME prompt quality for cheap-tier cascading readiness.
# Checks whether the prompt contains decomposition rules that would
# prevent the Applemint-session failure mode (monolithic multi-package
# dispatches to cheap models).
#
# Outputs score on last line. Higher is better. Max 100.
#
# Usage: bash eval/cascade-decomposition-eval.sh [prompt-file]

set -euo pipefail

PROMPT="${1:-packages/harness-opencode/src/agents/prompts/prime-ultra.md}"
score=0
total=0

check() {
  local points=$1
  local label=$2
  shift 2
  total=$((total + points))
  for pat in "$@"; do
    if grep -qiE "$pat" "$PROMPT" 2>/dev/null; then
      score=$((score + points))
      echo "  [+$points] $label"
      return
    fi
  done
  echo "  [  0] $label (MISSING)"
}

echo "Evaluating: $PROMPT"
echo ""

# === Task decomposition (40 points) ===
echo "=== Task decomposition ==="
check 10 "Per-file or per-package subtask rule" \
  "per.file" "one file" "single.file" "atomic.subtask" "per.package" "each file"
check 10 "Multi-package tasks must be decomposed" \
  "multi.package" "cross.package" "multiple packages" "spans?.*(multiple|several) package"
check 10 "Example of decomposed per-file dispatch" \
  "add.*method.*model" "create.*contract" "add.*route.*router" "one.*file.*per.*dispatch"
check 10 "Explicit anti-pattern: never dispatch entire phase" \
  "never.*entire phase" "do not.*whole phase" "monolithic" "not.*send.*phase as (one|a single)"

# === Cheap-tier gating (25 points) ===
echo ""
echo "=== Cheap-tier gating ==="
check 5 "Gate for file count threshold" \
  "[0-9]+ files"
check 5 "Gate for multi-package scope" \
  "multi.package" "cross.package" "multiple package" "span.*package"
check 5 "Gate for security-sensitive paths" \
  "[Ss]ecurity" "[Aa]uth" "[Cc]rypto" "[Bb]illing"
check 5 "Gate for high risk" \
  "[Rr]isk.*high" "high.*risk" "flagged.*risk"
check 5 "Gate for expensive downstream failures" \
  "cascade.fail" "downstream.*wave" "expensive.*fail" "dependencies.*fail"

# === Dispatch shape (20 points) ===
echo ""
echo "=== Dispatch shape ==="
check 10 "Sequential or isolated dispatch for shared worktree" \
  "sequential" "one at a time" "serial" "do not.*parallel.*same.*worktree" "never.*parallel.*one.*worktree"
check 10 "Worktree isolation for parallel code lanes" \
  "worktree.*isol" "separate.*worktree" "per.lane.*worktree" "worktree per" "isolat.*worktree"

# === Escalation (15 points) ===
echo ""
echo "=== Escalation signals ==="
check 5 "Escalate on BLOCKED" "BLOCKED"
check 5 "Escalate on FAIL_SPEC" "FAIL_SPEC"
check 5 "Escalate on empty/truncated output" \
  "[Ee]mpty.*output" "near.empty" "truncat"

echo ""
echo "Score: $score / $total"
echo "$score"
