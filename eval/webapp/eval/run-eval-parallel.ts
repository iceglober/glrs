/**
 * Parallel dispatch eval runner — runs autopilot against the "parallel-features"
 * plan (4 waves, 3 disjoint + 1 wiring), then scores with the 18-check scorer.
 *
 * A/B usage:
 *   Sequential:  bun run eval/webapp/eval/run-eval-parallel.ts
 *   Parallel:    EVAL_PARALLEL=3 bun run eval/webapp/eval/run-eval-parallel.ts
 *
 * The plan has zero file overlap across waves 0-2, so parallel=3 should
 * execute them concurrently. Comparing wall time between the two runs
 * measures the speedup from parallel subagent dispatch.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import { SessionRunner } from "../../../packages/autopilot/src/session-runner.js";
import { scoreParallel } from "./score-parallel.js";

const WEBAPP_DIR = path.resolve(import.meta.dir, "..");
const PLAN_DIR = path.join(WEBAPP_DIR, "plans", "parallel-features");
const DB_URL = "postgresql://eval:eval@localhost:5433/evaldb";

const REMOVE_PATHS = [
  "migrations/005_create_comments.sql",
  "migrations/006_create_tags.sql",
  "migrations/007_create_bookmarks.sql",
  "src/routes/comments.ts",
  "src/routes/tags.ts",
  "src/routes/bookmarks.ts",
  "test/comments.test.ts",
  "test/tags.test.ts",
  "test/bookmarks.test.ts",
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

  for (const rel of REMOVE_PATHS) {
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

  // Restore app.ts in case wave_3 modified it
  await $`cd ${WEBAPP_DIR} && git checkout -- src/app.ts 2>/dev/null || true`.quiet();

  // Remove spec directory from plan if enrichment created one
  const specDir = path.join(PLAN_DIR, "spec");
  if (fs.existsSync(specDir)) {
    fs.rmSync(specDir, { recursive: true, force: true });
  }

  // Drop feature tables and recreate baseline
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DROP TABLE IF EXISTS post_tags CASCADE');
    await pool.query('DROP TABLE IF EXISTS bookmarks CASCADE');
    await pool.query('DROP TABLE IF EXISTS comments CASCADE');
    await pool.query('DROP TABLE IF EXISTS tags CASCADE');
    await pool.end();
  "`.quiet();

  console.error("[eval] Webapp reset complete.");
}

async function runAutopilot(): Promise<{ durationS: number; costUsd: number }> {
  const adapter = await createAdapter();
  const startTime = Date.now();

  const parallel = process.env.EVAL_PARALLEL
    ? parseInt(process.env.EVAL_PARALLEL, 10)
    : undefined;
  if (parallel) {
    console.error(`[eval] Parallel lanes: ${parallel}`);
  }

  const runner = new SessionRunner({
    planPath: PLAN_DIR,
    cwd: WEBAPP_DIR,
    fast: true,
    maxIterationsPerPhase: 3,
    parallel,
    adapter,
    config: {
      adapter: "claude-code-cli",
      models: {
        enrichment: "claude-opus-4-7",
        execution: process.env.EVAL_EXECUTE_MODEL || "claude-sonnet-4-6",
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

  console.error("[eval] Running autopilot against parallel-features plan...");
  const result = await runner.run();
  const durationS = (Date.now() - startTime) / 1000;

  console.error(
    `[eval] Autopilot finished: ${result.loopResult.exitReason} (${result.loopResult.iterations} iterations, ${durationS.toFixed(0)}s)`,
  );

  return { durationS, costUsd: totalCost };
}

async function main() {
  console.error("[eval] Parallel-features eval starting...");
  console.error(`[eval] Plan: ${PLAN_DIR}`);
  console.error(`[eval] Webapp: ${WEBAPP_DIR}`);
  console.error(`[eval] Adapter: claude-code-cli`);
  console.error(
    `[eval] Execute model: ${process.env.EVAL_EXECUTE_MODEL || "claude-sonnet-4-6"}`,
  );
  console.error(
    `[eval] Parallel: ${process.env.EVAL_PARALLEL || "off (sequential)"}`,
  );

  await ensureDocker();
  await resetWebapp();

  const { durationS, costUsd } = await runAutopilot();

  // Run post-autopilot migrations
  console.error("[eval] Running post-autopilot migrations...");
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun run src/migrate.ts 2>/dev/null || true`.quiet();

  console.error("[eval] Scoring...");
  const result = await scoreParallel(WEBAPP_DIR, costUsd, durationS);
  console.log(JSON.stringify(result, null, 2));
  console.error(
    `[eval] Score: ${result.score.toFixed(3)} (accuracy=${result.accuracy.toFixed(3)}, ${result.checks_passed}/${result.checks_total} checks, cost=$${costUsd.toFixed(4)}, time=${durationS.toFixed(0)}s)`,
  );

  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.error("[eval] Failed checks:");
    for (const c of failed) {
      console.error(`  - ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    }
  }

  if (!process.env.EVAL_KEEP_OUTPUT) {
    await resetWebapp();
  } else {
    console.error(
      "[eval] EVAL_KEEP_OUTPUT=1 — skipping reset, webapp left in post-autopilot state.",
    );
  }
}

main().catch((err) => {
  console.error(`[eval] Fatal: ${err}`);
  process.exit(1);
});
