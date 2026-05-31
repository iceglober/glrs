#!/usr/bin/env bash
# cascade-outcome-eval.sh
#
# Tests whether the PRIME prompt actually produces correct task decomposition
# when given a realistic multi-package, full-stack synthetic task.
#
# Sends the prompt as system text to Haiku via Bedrock, gives it a synthetic
# task spanning 8 files across 5 packages (API, shared types, DB, frontend,
# infra/Terraform), and scores the response for decomposition quality.
#
# Requires: gsa (AWS credential wrapper), aws CLI, jq
# Caches responses by prompt SHA — same prompt skips the API call.
# Outputs score (0-100) on last line.
set -euo pipefail

PROMPT_FILE="${1:-packages/harness-opencode/src/agents/prompts/prime-ultra.md}"
MODEL="${EVAL_MODEL:-us.anthropic.claude-haiku-4-5-20251001-v1:0}"
REGION="${AWS_REGION:-us-east-1}"
CACHE_DIR="${TMPDIR:-/tmp}/cascade-outcome-cache"

echo "Evaluating outcome: $PROMPT_FILE"

# --- Pre-flight ---
for cmd in gsa jq; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd required"; echo "0"; exit 1; }
done
[[ -f "$PROMPT_FILE" ]] || { echo "ERROR: not found: $PROMPT_FILE"; echo "0"; exit 1; }

mkdir -p "$CACHE_DIR"
SHA=$(shasum -a 256 "$PROMPT_FILE" | cut -d' ' -f1)
MODEL_SLUG=$(echo "$MODEL" | tr ':/' '_')
CACHE="$CACHE_DIR/${SHA}-${MODEL_SLUG}.txt"

# --- Get model response (cached or fresh) ---
if [[ -f "$CACHE" ]]; then
  echo "Cache hit (prompt unchanged)"
  R=$(cat "$CACHE")
else
  echo "Sending to $MODEL via Bedrock..."

  read -r -d '' TASK <<'ENDTASK' || true
You are in the Execute phase. The plan has been written by @plan-ultra and reviewed ([OKAY]). Your job now: construct the execution DAG and describe your @build dispatch plan. Show each wave with the @build calls and their file scopes.

Monorepo layout:
packages/
  api/src/          — Express API server (TypeScript)
  shared/src/       — shared TS types and contracts
  db/migrations/    — SQL migrations (knex)
  frontend/src/     — React frontend (Vite + TypeScript)
  infra/terraform/  — Terraform IaC (AWS)

Plan (path: /plans/subscription-webhook.md):

## Goal
Add real-time subscription status tracking to the dashboard via Stripe webhooks.

## File-level changes
- packages/shared/src/types/billing.ts (CREATE) — StripeWebhookPayload, SubscriptionStatus types. Risk: low
- packages/shared/src/contracts/subscription.ts (CREATE) — subscription state contract, status enum. Risk: low
- packages/db/migrations/20240601_webhook_events.sql (CREATE) — webhook_events table with idempotency key. Risk: medium
- packages/api/src/routes/webhooks.ts (CREATE) — POST /webhooks/stripe route with signature verification. Risk: high
- packages/api/src/handlers/stripe-webhook.ts (CREATE) — event handler, subscription state machine. Risk: high
- packages/api/src/routes/subscription.ts (CREATE) — GET /api/subscription/status for authed users. Risk: low
- packages/frontend/src/components/SubscriptionStatus.tsx (CREATE) — tier, renewal date, payment status UI. Risk: low
- packages/infra/terraform/modules/api/webhook.tf (CREATE) — WAF IP allowlist rule + ALB listener rule for /webhooks/stripe. Risk: high

## Test plan
- Unit tests for webhook handler (mock Stripe signature)
- Integration test for subscription status endpoint
- Terraform plan (no apply) for infra changes

8 files across 5 packages. Construct the execution DAG and show @build dispatches.
ENDTASK

  TMPFILE=$(mktemp "${TMPDIR:-/tmp}/cascade-eval-XXXXXX.json")
  trap 'rm -f "$TMPFILE"' EXIT

  jq -n \
    --arg system "$(cat "$PROMPT_FILE")" \
    --arg task "$TASK" \
    --arg model "$MODEL" \
    '{
      modelId: $model,
      system: [{text: $system}],
      messages: [{role: "user", content: [{text: $task}]}],
      inferenceConfig: {maxTokens: 4096, temperature: 0}
    }' > "$TMPFILE"

  RAW=$(gsa exec --profile production -- aws bedrock-runtime converse \
    --region "$REGION" \
    --cli-input-json "file://$TMPFILE" 2>/dev/null)

  R=$(echo "$RAW" | jq -r '.output.message.content[0].text // empty')

  if [[ -z "$R" ]]; then
    echo "API error: $(echo "$RAW" | jq -r '.message // "unknown"')"
    echo "0"
    exit 1
  fi

  echo "$R" > "$CACHE"

  TOKENS_IN=$(echo "$RAW" | jq -r '.usage.inputTokens // "?"')
  TOKENS_OUT=$(echo "$RAW" | jq -r '.usage.outputTokens // "?"')
  LATENCY=$(echo "$RAW" | jq -r '.metrics.latencyMs // "?"')
  echo "Done (${TOKENS_IN} in / ${TOKENS_OUT} out, ${LATENCY}ms)"
fi

echo ""
echo "=== Response preview ==="
echo "$R" | head -30
echo "[...]"
echo ""

# --- Scoring (10 checks × 10 points = 100) ---
score=0; total=0
pass() { local p=$1; shift; total=$((total + p)); score=$((score + p)); echo "  [+$p] $*"; }
fail() { local p=$1; shift; total=$((total + p)); echo "  [  0] $* (MISSING)"; }

# Helper: first line number where pattern appears
first_line() { echo "$R" | grep -niE "$1" | head -1 | cut -d: -f1; }

echo "=== DAG structure ==="

# 1. Has structured waves/stages (≥3)
waves=$(echo "$R" | grep -oiE "(wave|phase|stage) [0-9]+" | sort -u | wc -l | tr -d ' ')
if [[ "$waves" -ge 3 ]]; then
  pass 10 "Has $waves waves/stages (need ≥3)"
else
  # Fallback: numbered list items with @build
  numbered=$(echo "$R" | grep -cE "^[0-9]+\." | tr -d ' ')
  if [[ "$numbered" -ge 3 ]]; then
    pass 10 "Has $numbered numbered stages (need ≥3)"
  else
    fail 10 "≥3 waves/stages (found $waves waves, $numbered numbered)"
  fi
fi

# 2. Multiple @build dispatches (≥3)
builds=$(echo "$R" | grep -oiE "@build" | wc -l | tr -d ' ')
if [[ "$builds" -ge 3 ]]; then
  pass 10 "Has $builds @build dispatches (need ≥3)"
else
  fail 10 "≥3 @build dispatches (found $builds)"
fi

echo ""
echo "=== Package ordering ==="

L_SHARED=$(first_line "shared/src|billing\.ts|contracts/subscription")
L_DB=$(first_line "migrations/|webhook_events|\.sql")
L_API=$(first_line "routes/webhook|stripe-webhook\.ts|handlers/stripe")
L_FRONT=$(first_line "frontend/src|SubscriptionStatus\.tsx")
L_INFRA=$(first_line "infra/terraform|webhook\.tf")

# 3. Shared types before frontend
if [[ -n "$L_SHARED" && -n "$L_FRONT" && "$L_SHARED" -lt "$L_FRONT" ]]; then
  pass 10 "Shared types before frontend (L$L_SHARED < L$L_FRONT)"
else
  fail 10 "Shared types before frontend (shared@${L_SHARED:-?} front@${L_FRONT:-?})"
fi

# 4. DB migration before frontend
if [[ -n "$L_DB" && -n "$L_FRONT" && "$L_DB" -lt "$L_FRONT" ]]; then
  pass 10 "DB migration before frontend (L$L_DB < L$L_FRONT)"
else
  fail 10 "DB migration before frontend (db@${L_DB:-?} front@${L_FRONT:-?})"
fi

# 5. API before frontend
if [[ -n "$L_API" && -n "$L_FRONT" && "$L_API" -lt "$L_FRONT" ]]; then
  pass 10 "API routes before frontend (L$L_API < L$L_FRONT)"
else
  fail 10 "API routes before frontend (api@${L_API:-?} front@${L_FRONT:-?})"
fi

echo ""
echo "=== Isolation ==="

# 6. Infrastructure mentioned and handled
if [[ -n "$L_INFRA" ]]; then
  pass 10 "Infrastructure (Terraform) included in plan"
else
  fail 10 "Infrastructure (Terraform) included in plan"
fi

# 7. File paths referenced (≥5 distinct package-relative paths)
paths=$(echo "$R" | grep -oiE "packages/[a-z]+(/[a-z_./-]+)+" | sort -u | wc -l | tr -d ' ')
if [[ "$paths" -ge 5 ]]; then
  pass 10 "≥5 distinct file paths referenced ($paths found)"
else
  fail 10 "≥5 distinct file paths (found $paths)"
fi

echo ""
echo "=== Decomposition quality ==="

# 8. Dependency ordering language
if echo "$R" | grep -qiE "depend|requires|after.*wave|blocked|prerequisite|imports from|needs.*output|before.*can"; then
  pass 10 "Dependency ordering language present"
else
  fail 10 "Dependency ordering language"
fi

# 9. Per-file or per-package decomposition language
if echo "$R" | grep -qiE "per.file|per.package|each file|one file per|atomic|package boundar|split.*package|separate.*package"; then
  pass 10 "Per-file/per-package decomposition language"
else
  fail 10 "Per-file/per-package decomposition language"
fi

# 10. No monolithic all-in-one dispatch
if echo "$R" | grep -qiE "all 8 files|all eight|single dispatch.*(all|every)|one @build.*all files"; then
  fail 10 "Avoids monolithic dispatch (found all-in-one pattern)"
else
  pass 10 "Avoids monolithic dispatch"
fi

echo ""
echo "Score: $score / $total"
echo "$score"
