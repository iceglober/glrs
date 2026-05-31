#!/usr/bin/env bash
# run-harness-eval.sh
#
# Runs the full harness (opencode + PRIME-ultra) headlessly against the webapp
# eval task, then scores the result with the real test suite.
#
# Flow:
# 1. Reset webapp to clean state (drop posts table, restore files)
# 2. Start Docker Postgres
# 3. Run opencode headlessly with PRIME-ultra agent
# 4. Run post-execution migrations
# 5. Score with real tests + API checks
#
# Usage:
#   bash eval/webapp/eval/run-harness-eval.sh [simple|complex]
#
# Environment:
#   EVAL_AGENT     — agent to use (default: prime-ultra)
#   EVAL_MODEL     — model override (default: let harness config decide)
#   EVAL_KEEP      — set to 1 to keep output after scoring (default: reset)
set -euo pipefail

WEBAPP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$WEBAPP_DIR/../.." && pwd)"
EVAL_TYPE="${1:-simple}"
AGENT="${EVAL_AGENT:-prime-ultra}"
DB_URL="postgresql://eval:eval@localhost:5433/evaldb"

echo "[eval] Harness eval starting..."
echo "[eval] Type: $EVAL_TYPE"
echo "[eval] Agent: $AGENT"
echo "[eval] Webapp: $WEBAPP_DIR"
echo "[eval] Model override: ${EVAL_MODEL:-<harness default>}"

# --- Docker ---
echo "[eval] Ensuring Docker Postgres..."
cd "$WEBAPP_DIR" && docker compose up -d --wait 2>&1 | tail -1
sleep 2
DATABASE_URL="$DB_URL" bun -e "
  import pg from 'pg';
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('SELECT 1');
  await pool.end();
  console.log('[eval] Postgres OK');
"

# --- Reset ---
echo "[eval] Resetting webapp..."
case "$EVAL_TYPE" in
  simple)
    rm -f "$WEBAPP_DIR/src/routes/posts.ts" "$WEBAPP_DIR/test/posts.test.ts" "$WEBAPP_DIR/migrations/002_create_posts.sql"
    cd "$WEBAPP_DIR" && git checkout -- src/app.ts public/index.html 2>/dev/null || true
    rm -rf "$WEBAPP_DIR/plans/add-posts/spec"
    DATABASE_URL="$DB_URL" bun -e "
      import pg from 'pg';
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('DROP TABLE IF EXISTS posts CASCADE');
      await pool.end();
    "
    DATABASE_URL="$DB_URL" bun run src/migrate.ts
    PLAN_PATH="plans/add-posts"
    TASK="Execute the plan at $PLAN_PATH. The plan has waves — execute wave_0 first, then wave_1. Follow the plan exactly."
    SCORER="eval/score.ts"
    ;;
  complex)
    for f in src/auth.ts src/middleware src/routes/auth.ts src/routes/analytics.ts \
             migrations/003_auth.sql migrations/004_search.sql \
             test/auth.test.ts test/auth-middleware.test.ts test/auth-protected.test.ts \
             test/search.test.ts test/pagination.test.ts test/analytics.test.ts; do
      rm -rf "$WEBAPP_DIR/$f"
    done
    cd "$WEBAPP_DIR" && git checkout -- src/app.ts src/routes/users.ts src/routes/posts.ts test/users.test.ts test/posts.test.ts 2>/dev/null || true
    rm -rf "$WEBAPP_DIR/plans/auth-search-analytics/spec"
    DATABASE_URL="$DB_URL" bun -e "
      import pg from 'pg';
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('DROP TABLE IF EXISTS sessions CASCADE');
      await pool.query('DROP TABLE IF EXISTS posts CASCADE');
      await pool.query('DROP TABLE IF EXISTS users CASCADE');
      await pool.query('DROP TABLE IF EXISTS migrations CASCADE');
      await pool.end();
    "
    DATABASE_URL="$DB_URL" bun run src/migrate.ts
    PLAN_PATH="plans/auth-search-analytics"
    TASK="Execute the plan at $PLAN_PATH. The plan has 4 waves (wave_0 through wave_3). Execute each wave in order, following the plan exactly."
    SCORER="eval/score-complex.ts"
    ;;
esac
echo "[eval] Reset complete."

# --- Run harness ---
echo "[eval] Running opencode headlessly with agent=$AGENT..."
START_TIME=$(date +%s)

MODEL_FLAG=""
if [[ -n "${EVAL_MODEL:-}" ]]; then
  MODEL_FLAG="--model $EVAL_MODEL"
fi

cd "$WEBAPP_DIR"
opencode run \
  --agent "$AGENT" \
  --dangerously-skip-permissions \
  --format json \
  $MODEL_FLAG \
  "$TASK" 2>&1 | tee /tmp/harness-eval-output.json | tail -5 >&2

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo "[eval] Harness finished in ${DURATION}s"

# --- Post-execution migrations ---
echo "[eval] Running post-execution migrations..."
DATABASE_URL="$DB_URL" bun run src/migrate.ts 2>/dev/null || true

# --- Score ---
echo "[eval] Scoring..."
cd "$WEBAPP_DIR"
RESULT=$(DATABASE_URL="$DB_URL" bun run "$SCORER" "$WEBAPP_DIR" --cost 0 --duration "$DURATION" 2>/dev/null)
echo "$RESULT" | jq .

ACCURACY=$(echo "$RESULT" | jq -r '.accuracy')
CHECKS_PASSED=$(echo "$RESULT" | jq -r '.checks_passed')
CHECKS_TOTAL=$(echo "$RESULT" | jq -r '.checks_total')
echo "[eval] Accuracy: $ACCURACY ($CHECKS_PASSED/$CHECKS_TOTAL checks)"

# Print failed checks
echo "$RESULT" | jq -r '.checks[] | select(.passed == false) | "  FAIL: \(.name)\(if .detail then " — \(.detail)" else "" end)"'

# --- Reset (unless EVAL_KEEP=1) ---
if [[ "${EVAL_KEEP:-}" != "1" ]]; then
  echo "[eval] Resetting for next run..."
  # Same reset as above — abbreviated
  case "$EVAL_TYPE" in
    simple)
      rm -f "$WEBAPP_DIR/src/routes/posts.ts" "$WEBAPP_DIR/test/posts.test.ts" "$WEBAPP_DIR/migrations/002_create_posts.sql"
      cd "$WEBAPP_DIR" && git checkout -- src/app.ts public/index.html 2>/dev/null || true
      ;;
    complex)
      for f in src/auth.ts src/middleware src/routes/auth.ts src/routes/analytics.ts \
               migrations/003_auth.sql migrations/004_search.sql \
               test/auth.test.ts test/analytics.test.ts; do
        rm -rf "$WEBAPP_DIR/$f"
      done
      cd "$WEBAPP_DIR" && git checkout -- src/app.ts src/routes/users.ts src/routes/posts.ts test/users.test.ts test/posts.test.ts 2>/dev/null || true
      ;;
  esac
else
  echo "[eval] EVAL_KEEP=1 — leaving webapp in post-execution state."
fi

echo "[eval] Done. Accuracy: $ACCURACY"
