/**
 * Autoresearch loop for complex webapp eval.
 *
 * Runs the eval, analyzes failures, mutates plan/prompts/config,
 * re-runs, and keeps the best-scoring configuration.
 *
 * Tracks iteration history in eval/webapp/eval/autoresearch-results/.
 *
 * Usage: bun run eval/webapp/eval/autoresearch.ts [--iterations N] [--from N]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import { SessionRunner } from "../../../packages/autopilot/src/session-runner.js";
import { scoreComplex } from "./score-complex.js";

const WEBAPP_DIR = path.resolve(import.meta.dir, "..");
const PLAN_DIR = path.join(WEBAPP_DIR, "plans", "auth-search-analytics");
const VARIANTS_DIR = path.join(import.meta.dir, "plan-variants");
const DB_URL = "postgresql://eval:eval@localhost:5433/evaldb";
const RESULTS_DIR = path.join(import.meta.dir, "autoresearch-results");

interface IterationResult {
  iteration: number;
  score: number;
  accuracy: number;
  checks_passed: number;
  checks_total: number;
  cost_usd: number;
  duration_s: number;
  cost_score: number;
  speed_score: number;
  failed_checks: string[];
  changes_made: string;
  timestamp: string;
}

function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function applyVariant(variantPrefix: string) {
  const variantFiles = fs.readdirSync(VARIANTS_DIR).filter((f) => f.startsWith(variantPrefix) && f.endsWith(".md"));
  if (variantFiles.length === 0) throw new Error(`No variant files matching prefix "${variantPrefix}" in ${VARIANTS_DIR}`);

  // Remove existing wave files from plan dir
  for (const f of fs.readdirSync(PLAN_DIR)) {
    if (f.startsWith("wave_") && f.endsWith(".md")) {
      fs.unlinkSync(path.join(PLAN_DIR, f));
    }
  }

  // Copy variant wave files, stripping the variant prefix
  for (const f of variantFiles) {
    const destName = f.replace(`${variantPrefix}-`, "");
    fs.copyFileSync(path.join(VARIANTS_DIR, f), path.join(PLAN_DIR, destName));
  }
  console.error(`  Applied variant "${variantPrefix}": ${variantFiles.length} wave files`);
}

function loadHistory(): IterationResult[] {
  const histFile = path.join(RESULTS_DIR, "history.json");
  if (!fs.existsSync(histFile)) return [];
  return JSON.parse(fs.readFileSync(histFile, "utf8"));
}

function saveHistory(history: IterationResult[]) {
  fs.writeFileSync(path.join(RESULTS_DIR, "history.json"), JSON.stringify(history, null, 2));
}

function savePlanSnapshot(iteration: number) {
  const snapDir = path.join(RESULTS_DIR, `iter-${iteration}`, "plan");
  fs.mkdirSync(snapDir, { recursive: true });
  for (const f of fs.readdirSync(PLAN_DIR)) {
    if (f.endsWith(".md")) {
      fs.copyFileSync(path.join(PLAN_DIR, f), path.join(snapDir, f));
    }
  }
  // Also snapshot the enrichment strategy
  const stratSrc = path.resolve(WEBAPP_DIR, "../../packages/autopilot/src/strategies/default.md");
  if (fs.existsSync(stratSrc)) {
    fs.copyFileSync(stratSrc, path.join(RESULTS_DIR, `iter-${iteration}`, "strategy.md"));
  }
}

async function createAdapter(enrichModel = "claude-opus-4-7", executeModel = "claude-sonnet-4-6") {
  const { ClaudeCodeCliAdapter } = await import(
    "../../../packages/adapter-claude-code/src/claude-code-adapter.js"
  );
  return new ClaudeCodeCliAdapter({
    dangerouslySkipPermissions: true,
    models: {
      enrich: enrichModel,
      execute: executeModel,
    },
  });
}

async function ensureDocker() {
  await $`cd ${WEBAPP_DIR} && docker compose up -d --wait`.quiet();
  await $`sleep 2`;
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('SELECT 1');
    await pool.end();
  "`.quiet();
}

async function resetWebapp() {
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

  await $`cd ${WEBAPP_DIR} && git checkout -- src/app.ts src/routes/users.ts src/routes/posts.ts test/users.test.ts test/posts.test.ts 2>/dev/null || true`.quiet();

  const specDir = path.join(PLAN_DIR, "spec");
  if (fs.existsSync(specDir)) {
    fs.rmSync(specDir, { recursive: true, force: true });
  }

  // Restore cached spec if available (skip enrichment on re-runs)
  const cachedSpec = path.join(RESULTS_DIR, "cached-spec");
  if (fs.existsSync(cachedSpec)) {
    fs.cpSync(cachedSpec, specDir, { recursive: true });
    // Reset all checked/completed flags so execution runs every item
    for (const f of fs.readdirSync(specDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        const fp = path.join(specDir, f);
        let content = fs.readFileSync(fp, "utf8");
        content = content.replace(/checked:\s*true/g, "checked: false");
        content = content.replace(/completed:\s*true/g, "completed: false");
        fs.writeFileSync(fp, content);
      }
    }
  }

  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DROP TABLE IF EXISTS sessions CASCADE');
    await pool.query('DROP TABLE IF EXISTS posts CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    await pool.query('DROP TABLE IF EXISTS migrations CASCADE');
    await pool.end();
  "`.quiet();

  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun run src/migrate.ts`.quiet();
}

async function runAndScore(iteration: number, opts?: { configOverrides?: Record<string, unknown>; enrichModel?: string; executeModel?: string }): Promise<IterationResult & { checks: Array<{ name: string; passed: boolean; detail?: string }> }> {
  await resetWebapp();

  const enrichModel = opts?.enrichModel ?? "claude-opus-4-7";
  const executeModel = opts?.executeModel ?? "claude-sonnet-4-6";
  const adapter = await createAdapter(enrichModel, executeModel);
  const startTime = Date.now();

  const baseConfig: Record<string, unknown> = {
    adapter: "claude-code-cli",
    models: {
      enrichment: enrichModel,
      execution: executeModel,
    },
    ...opts?.configOverrides,
  };

  const runner = new SessionRunner({
    planPath: PLAN_DIR,
    cwd: WEBAPP_DIR,
    fast: true,
    maxIterationsPerPhase: 3,
    adapter,
    config: baseConfig,
  });

  let totalCost = 0;
  runner.events.on("event", (event: { type: string; cumulativeCostUsd?: number }) => {
    if (event.type === "cost:update" && event.cumulativeCostUsd !== undefined) {
      totalCost = Math.max(totalCost, event.cumulativeCostUsd);
    }
  });

  runner.events.on("event", (event: { type: string; [key: string]: unknown }) => {
    const ts = new Date().toISOString().slice(11, 19);
    if (event.type === "phase:start") {
      console.error(`  [${ts}] Phase start: ${event.phase}`);
    } else if (event.type === "phase:done") {
      console.error(`  [${ts}] Phase done: ${event.phase}`);
    } else if (event.type === "iteration:start") {
      console.error(`  [${ts}] Iteration ${event.iteration}`);
    } else if (event.type === "enrich:start") {
      console.error(`  [${ts}] Enrichment starting...`);
    } else if (event.type === "enrich:done") {
      console.error(`  [${ts}] Enrichment complete.`);
    } else if (event.type === "error") {
      console.error(`  [${ts}] Error: ${event.message}`);
    }
  });

  const result = await runner.run();
  const durationS = (Date.now() - startTime) / 1000;

  console.error(`  Autopilot finished: ${result.loopResult.exitReason} (${result.loopResult.iterations} iterations, ${durationS.toFixed(0)}s)`);

  // Run post-autopilot migrations
  await $`cd ${WEBAPP_DIR} && DATABASE_URL=${DB_URL} bun run src/migrate.ts 2>/dev/null || true`.quiet();

  const scoreResult = await scoreComplex(WEBAPP_DIR, totalCost, durationS);

  const failed = scoreResult.checks.filter((c) => !c.passed).map((c) => c.name);

  return {
    iteration,
    score: scoreResult.score,
    accuracy: scoreResult.accuracy,
    checks_passed: scoreResult.checks_passed,
    checks_total: scoreResult.checks_total,
    cost_usd: totalCost,
    duration_s: durationS,
    cost_score: scoreResult.cost_score,
    speed_score: scoreResult.speed_score,
    failed_checks: failed,
    changes_made: "",
    timestamp: new Date().toISOString(),
    checks: scoreResult.checks,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const iterIdx = args.indexOf("--iterations");
  const maxIterations = iterIdx >= 0 ? parseInt(args[iterIdx + 1]) : 5;
  const fromIdx = args.indexOf("--from");
  const startFrom = fromIdx >= 0 ? parseInt(args[fromIdx + 1]) : 0;
  const variantIdx = args.indexOf("--variant");
  const variant = variantIdx >= 0 ? args[variantIdx + 1] : undefined;
  const useDirectMode = args.includes("--direct");
  const useSonnetEnrich = args.includes("--sonnet-enrich");
  const enrichModel = useSonnetEnrich ? "claude-sonnet-4-6" : "claude-opus-4-7";
  const cacheSpec = args.includes("--cache-spec");
  const useCachedSpec = args.includes("--use-cached-spec");
  const useHaikuExecute = args.includes("--haiku-execute");
  const executeModel = useHaikuExecute ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";

  ensureResultsDir();
  await ensureDocker();

  if (variant) {
    applyVariant(variant);
  }

  const configOverrides: Record<string, unknown> = {};
  if (useDirectMode) {
    configOverrides.execution_style = "direct";
    console.error("  Using direct execution mode (no TDD)");
  }
  if (useSonnetEnrich) {
    console.error("  Using sonnet for enrichment (faster, potentially lower quality)");
  }
  if (useHaikuExecute) {
    console.error("  Using haiku for execution (faster, potentially lower accuracy)");
  }

  const history = loadHistory();
  let bestScore = history.length > 0 ? Math.max(...history.map((h) => h.score)) : 0;

  console.error(`=== Autoresearch loop: ${maxIterations} iterations, starting from ${startFrom} ===`);
  if (history.length > 0) {
    console.error(`  Previous best score: ${bestScore.toFixed(3)}`);
  }

  for (let i = startFrom; i < startFrom + maxIterations; i++) {
    console.error(`\n--- Iteration ${i} ---`);

    savePlanSnapshot(i);

    const runOpts = {
      configOverrides: Object.keys(configOverrides).length > 0 ? configOverrides : undefined,
      enrichModel,
      executeModel,
    };
    const result = await runAndScore(i, runOpts);
    if (!result.changes_made) {
      const parts = [variant ? `variant: ${variant}` : "baseline"];
      if (useDirectMode) parts.push("direct");
      if (useSonnetEnrich) parts.push("sonnet-enrich");
      if (useHaikuExecute) parts.push("haiku-execute");
      if (useCachedSpec) parts.push("cached-spec");
      result.changes_made = parts.join(", ");
    }

    // Cache spec after first successful run if requested
    const specDir = path.join(PLAN_DIR, "spec");
    const cachedSpec = path.join(RESULTS_DIR, "cached-spec");
    if (cacheSpec && result.accuracy === 1 && fs.existsSync(specDir) && !fs.existsSync(cachedSpec)) {
      fs.cpSync(specDir, cachedSpec, { recursive: true });
      console.error("  Cached spec for future runs");
    }

    // Save detailed results
    const iterDir = path.join(RESULTS_DIR, `iter-${i}`);
    fs.mkdirSync(iterDir, { recursive: true });
    fs.writeFileSync(
      path.join(iterDir, "result.json"),
      JSON.stringify(result, null, 2),
    );

    // Update history
    const { checks, ...histEntry } = result;
    history.push(histEntry);
    saveHistory(history);

    const isBest = result.score > bestScore;
    if (isBest) bestScore = result.score;

    console.error(`\n  Score: ${result.score.toFixed(3)} ${isBest ? "(NEW BEST)" : ""}`);
    console.error(`  Accuracy: ${result.accuracy.toFixed(3)} (${result.checks_passed}/${result.checks_total})`);
    console.error(`  Speed: ${result.duration_s.toFixed(0)}s (score=${result.speed_score.toFixed(3)})`);
    console.error(`  Cost: $${result.cost_usd.toFixed(4)} (score=${result.cost_score.toFixed(3)})`);
    if (result.failed_checks.length > 0) {
      console.error(`  Failed: ${result.failed_checks.join(", ")}`);
    }

    // Print detailed failure info for analysis
    const failedDetails = result.checks.filter((c) => !c.passed);
    if (failedDetails.length > 0) {
      console.error("  Failure details:");
      for (const c of failedDetails) {
        console.error(`    ${c.name}: ${c.detail || "(no detail)"}`);
      }
    }

    console.error(`\n  Best so far: ${bestScore.toFixed(3)}`);
  }

  // Print summary
  console.error("\n=== Summary ===");
  for (const h of history) {
    const marker = h.score === bestScore ? " *" : "";
    console.error(
      `  Iter ${h.iteration}: score=${h.score.toFixed(3)} accuracy=${h.accuracy.toFixed(3)} ` +
      `speed=${h.speed_score.toFixed(3)} (${h.duration_s.toFixed(0)}s) ${h.failed_checks.length > 0 ? `fails=[${h.failed_checks.join(",")}]` : ""}${marker}`,
    );
  }

  // Print JSON for piping
  console.log(JSON.stringify(history, null, 2));
}

main().catch((err) => {
  console.error(`[autoresearch] Fatal: ${err}`);
  process.exit(1);
});
