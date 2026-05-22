/**
 * Complex webapp eval runner — runs autopilot against the "auth-search-analytics"
 * plan (4 waves, ~12 items), then scores with the 30-check scorer.
 *
 * Usage: bun run eval/webapp/eval/run-eval-complex.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import { SessionRunner } from "../../../packages/autopilot/src/session-runner.js";
import { scoreComplex } from "./score-complex.js";

const WEBAPP_DIR = path.resolve(import.meta.dir, "..");
const PLAN_DIR = path.join(WEBAPP_DIR, "plans", "auth-search-analytics");
const DB_URL = "postgresql://eval:eval@localhost:5433/evaldb";

const BASELINE_FILES = new Set([
  "src/app.ts",
  "src/db.ts",
  "src/migrate.ts",
  "src/routes/users.ts",
  "src/routes/posts.ts",
  "test/users.test.ts",
  "test/posts.test.ts",
  "migrations/001_create_users.sql",
  "migrations/002_create_posts.sql",
]);

const AUTOPILOT_GENERATED_DIRS = [
  "src/middleware",
  "src/routes/analytics.ts",
];

async function createAdapter() {
  const { ClaudeCodeCliAdapter } = await import(
    "../../../packages/adapter-claude-code/src/claude-code-adapter.js"
  );
  return new ClaudeCodeCliAdapter({
    dangerouslySkipPermissions: true,
    models: {
      enrich: "claude-opus-4-7",
      execute: "claude-sonnet-4-6",
    },
  });
}

async function ensureDocker() {
  console.error("[eval] Ensuring Docker Postgres is running...");
  await $`cd ${WEBAPP_DIR} && docker compose up -d --wait`.quiet();
  await $`sleep 2`;
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('SELECT 1');
    await pool.end();
    console.log('ok');
  "`.quiet();
  console.error("[eval] Postgres is ready.");
}

async function resetWebapp() {
  console.error("[eval] Resetting webapp to clean state...");

  // Remove autopilot-generated files that don't exist in baseline
  const removePaths = [
    "src/auth.ts",
    "src/middleware",
    "src/routes/auth.ts",
    "src/routes/analytics.ts",
    "migrations/003_auth.sql",
    "migrations/004_search.sql",
    "test/auth.test.ts",
    "test/auth-middleware.test.ts",
    "test/auth-protected.test.ts",
    "test/search.test.ts",
    "test/pagination.test.ts",
    "test/analytics.test.ts",
  ];
  for (const rel of removePaths) {
    const fp = path.join(WEBAPP_DIR, rel);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        fs.rmSync(fp, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fp);
      }
    }
  }

  // Restore baseline files from git
  await $`cd ${WEBAPP_DIR} && git checkout -- src/app.ts src/routes/users.ts src/routes/posts.ts test/users.test.ts test/posts.test.ts 2>/dev/null || true`.quiet();

  // Remove spec directory from plan if enrichment created one
  const specDir = path.join(PLAN_DIR, "spec");
  if (fs.existsSync(specDir)) {
    fs.rmSync(specDir, { recursive: true, force: true });
  }

  // Drop all tables and recreate from baseline migrations
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DROP TABLE IF EXISTS sessions CASCADE');
    await pool.query('DROP TABLE IF EXISTS posts CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.query('DROP TABLE IF EXISTS migrations CASCADE');
    await pool.end();
  "`.quiet();

  // Re-run baseline migrations
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun run src/migrate.ts`.quiet();
  console.error("[eval] Webapp reset complete.");
}

async function runAutopilot(): Promise<{ durationS: number; costUsd: number }> {
  const adapter = await createAdapter();
  const startTime = Date.now();

  const runner = new SessionRunner({
    planPath: PLAN_DIR,
    cwd: WEBAPP_DIR,
    fast: true,
    maxIterationsPerPhase: 3,
    adapter,
    config: {
      adapter: "claude-code-cli",
      models: {
        enrichment: "claude-opus-4-7",
        execution: "claude-sonnet-4-6",
      },
    },
  });

  let totalCost = 0;
  runner.events.on("event", (event: { type: string; cumulativeCostUsd?: number }) => {
    if (event.type === "cost:update" && event.cumulativeCostUsd !== undefined) {
      totalCost = Math.max(totalCost, event.cumulativeCostUsd);
    }
  });

  runner.events.on("event", (event: { type: string; [key: string]: unknown }) => {
    if (event.type === "phase:start") {
      console.error(`[eval] Phase start: ${event.phase}`);
    } else if (event.type === "phase:done") {
      console.error(`[eval] Phase done: ${event.phase}`);
    } else if (event.type === "iteration:start") {
      console.error(`[eval] Iteration ${event.iteration}`);
    } else if (event.type === "enrich:start") {
      console.error("[eval] Enrichment starting...");
    } else if (event.type === "enrich:done") {
      console.error("[eval] Enrichment complete.");
    } else if (event.type === "error") {
      console.error(`[eval] Error: ${event.message}`);
    }
  });

  console.error("[eval] Running autopilot against auth-search-analytics plan...");
  const result = await runner.run();
  const durationS = (Date.now() - startTime) / 1000;

  console.error(`[eval] Autopilot finished: ${result.loopResult.exitReason} (${result.loopResult.iterations} iterations, ${durationS.toFixed(0)}s)`);

  return { durationS, costUsd: totalCost };
}

async function main() {
  console.error("[eval] Complex webapp eval starting...");
  console.error(`[eval] Plan: ${PLAN_DIR}`);
  console.error(`[eval] Webapp: ${WEBAPP_DIR}`);

  await ensureDocker();
  await resetWebapp();

  const { durationS, costUsd } = await runAutopilot();

  // Run post-autopilot migrations
  console.error("[eval] Running post-autopilot migrations...");
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun run src/migrate.ts 2>/dev/null || true`.quiet();

  console.error("[eval] Scoring...");
  const result = await scoreComplex(WEBAPP_DIR, costUsd, durationS);
  console.log(JSON.stringify(result, null, 2));
  console.error(`[eval] Score: ${result.score.toFixed(3)} (accuracy=${result.accuracy.toFixed(3)}, ${result.checks_passed}/${result.checks_total} checks, cost=$${costUsd.toFixed(4)}, time=${durationS.toFixed(0)}s)`);

  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.error("[eval] Failed checks:");
    for (const c of failed) {
      console.error(`  - ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
  }

  // Reset for next run (unless EVAL_KEEP_OUTPUT=1)
  if (!process.env.EVAL_KEEP_OUTPUT) {
    await resetWebapp();
  } else {
    console.error("[eval] EVAL_KEEP_OUTPUT=1 — skipping reset, webapp left in post-autopilot state.");
  }
}

main().catch((err) => {
  console.error(`[eval] Fatal: ${err}`);
  process.exit(1);
});
