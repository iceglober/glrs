/**
 * Webapp eval runner — runs autopilot against the "add-posts" plan,
 * then scores the result.
 *
 * Lifecycle:
 * 1. Reset webapp to clean state (git checkout, drop posts table)
 * 2. Ensure Docker Postgres is running
 * 3. Run migrations (baseline state)
 * 4. Run autopilot enrichment + execution
 * 5. Run migrations again (autopilot may have added new ones)
 * 6. Score the result
 * 7. Reset webapp state
 *
 * Usage: bun run eval/webapp/eval/run-eval.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import { SessionRunner } from "../../../packages/autopilot/src/session-runner.js";
import { scoreWebapp } from "./score.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const WEBAPP_DIR = path.resolve(import.meta.dir, "..");
const PLAN_DIR = path.join(WEBAPP_DIR, "plans", "add-posts");

const ENRICH_MODEL = process.env.EVAL_ENRICH_MODEL ?? "claude-opus-4-7";
const EXECUTE_MODEL = process.env.EVAL_EXECUTE_MODEL ?? "claude-sonnet-4-6";

async function createAdapter() {
  const { ClaudeCodeCliAdapter } = await import(
    "../../../packages/adapter-claude-code/src/claude-code-adapter.js"
  );
  return new ClaudeCodeCliAdapter({
    dangerouslySkipPermissions: true,
    models: {
      enrich: ENRICH_MODEL,
      execute: EXECUTE_MODEL,
    },
  });
}

async function ensureDocker() {
  console.error("[eval] Ensuring Docker Postgres is running...");
  await $`cd ${WEBAPP_DIR} && docker compose up -d --wait`.quiet();
  await $`sleep 2`;
  // Verify connection
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=postgresql://eval:eval@localhost:5433/evaldb bun -e "
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
  // Remove any autopilot-generated files
  const generatedFiles = [
    "src/routes/posts.ts",
    "test/posts.test.ts",
    "migrations/002_create_posts.sql",
  ];
  for (const f of generatedFiles) {
    const fp = path.join(WEBAPP_DIR, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  // Restore modified files from git
  await $`cd ${WEBAPP_DIR} && git checkout -- src/app.ts public/index.html 2>/dev/null || true`.quiet();

  // Remove spec directory if enrichment created one
  const specDir = path.join(PLAN_DIR, "spec");
  if (fs.existsSync(specDir)) {
    fs.rmSync(specDir, { recursive: true, force: true });
  }

  // Drop posts table if it exists
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=postgresql://eval:eval@localhost:5433/evaldb bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DROP TABLE IF EXISTS posts CASCADE');
    await pool.end();
  "`.quiet();

  // Re-run baseline migrations
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=postgresql://eval:eval@localhost:5433/evaldb bun run src/migrate.ts`.quiet();
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
        enrichment: ENRICH_MODEL,
        execution: EXECUTE_MODEL,
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

  console.error("[eval] Running autopilot...");
  const result = await runner.run();
  const durationS = (Date.now() - startTime) / 1000;

  console.error(`[eval] Autopilot finished: ${result.loopResult.exitReason} (${result.loopResult.iterations} iterations, ${durationS.toFixed(0)}s)`);

  return { durationS, costUsd: totalCost };
}

async function main() {
  console.error("[eval] Webapp eval starting...");
  console.error(`[eval] Plan: ${PLAN_DIR}`);
  console.error(`[eval] Webapp: ${WEBAPP_DIR}`);
  console.error(`[eval] Enrich model: ${ENRICH_MODEL}`);
  console.error(`[eval] Execute model: ${EXECUTE_MODEL}`);

  await ensureDocker();
  await resetWebapp();

  const { durationS, costUsd } = await runAutopilot();

  // Run new migrations (autopilot may have created 002_create_posts.sql)
  console.error("[eval] Running post-autopilot migrations...");
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=postgresql://eval:eval@localhost:5433/evaldb bun run src/migrate.ts 2>/dev/null || true`.quiet();

  console.error("[eval] Scoring...");
  const result = await scoreWebapp(WEBAPP_DIR, costUsd, durationS);
  console.log(JSON.stringify(result, null, 2));
  console.error(`[eval] Score: ${result.score.toFixed(3)} (accuracy=${result.accuracy.toFixed(3)}, ${result.checks_passed}/${result.checks_total} checks, cost=$${costUsd.toFixed(4)}, time=${durationS.toFixed(0)}s)`);

  // Print failed checks
  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.error("[eval] Failed checks:");
    for (const c of failed) {
      console.error(`  - ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
  }

  // Reset for next run
  await resetWebapp();
}

main().catch((err) => {
  console.error(`[eval] Fatal: ${err}`);
  process.exit(1);
});
