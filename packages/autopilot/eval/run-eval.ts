/**
 * Eval runner — runs enrichment against a plan and outputs a quality score.
 *
 * Usage: bun run packages/autopilot/eval/run-eval.ts
 *
 * Environment:
 *   EVAL_PLAN_DIR — source plan directory (default: docs/plans/20260515_configs)
 *   EVAL_WAVES    — comma-separated wave files to include (default: wave_0.md,wave_1.md)
 *
 * Copies the specified waves to a temp directory, runs enrichment via the
 * claude-code-cli adapter, scores the output, and prints the result to stdout.
 * The temp directory is cleaned up on exit.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enrichPlan } from "../src/plan-enrichment.js";
import { createAutopilotLogger } from "../src/lib/logger.js";
import { SessionEventEmitter } from "../src/session-runner.js";
import { scoreEnrichment } from "./score.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

async function createAdapter() {
  const { ClaudeCodeCliAdapter } = await import("../../adapter-claude-code/src/claude-code-adapter.js");
  return new ClaudeCodeCliAdapter({
    dangerouslySkipPermissions: true,
    models: {
      enrich: "claude-opus-4-7",
      execute: "claude-haiku-4-5-20251001",
    },
  });
}

function setupTempPlan(sourcePlanDir: string, waveFiles: string[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-eval-"));
  const planDir = path.join(tmpDir, "plan");
  fs.mkdirSync(planDir, { recursive: true });

  for (const wave of waveFiles) {
    const src = path.join(sourcePlanDir, wave);
    if (!fs.existsSync(src)) {
      console.error(`Wave file not found: ${src}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(planDir, wave));
  }

  const sourceMain = path.join(sourcePlanDir, "main.md");
  if (fs.existsSync(sourceMain)) {
    const mainContent = fs.readFileSync(sourceMain, "utf-8");
    const lines = mainContent.split("\n");
    const filteredLines = lines.filter((line) => {
      const waveRef = line.match(/\[?(wave_\d+\.md)\]?/);
      if (!waveRef) return true;
      return waveFiles.includes(waveRef[1]);
    });
    fs.writeFileSync(path.join(planDir, "main.md"), filteredLines.join("\n"));
  } else {
    const phaseList = waveFiles.map((w) => `- [ ] ${w}`).join("\n");
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# Eval Plan\n\n## Goal\nEval enrichment quality\n\n## Phases\n${phaseList}\n`,
    );
  }

  return planDir;
}

async function main() {
  const sourcePlanDir = path.resolve(
    REPO_ROOT,
    process.env["EVAL_PLAN_DIR"] ?? "docs/plans/20260515_configs",
  );
  const waveFiles = (process.env["EVAL_WAVES"] ?? "wave_0.md,wave_1.md")
    .split(",")
    .map((w) => w.trim());

  console.error(`[eval] Source plan: ${sourcePlanDir}`);
  console.error(`[eval] Waves: ${waveFiles.join(", ")}`);

  const planDir = setupTempPlan(sourcePlanDir, waveFiles);
  console.error(`[eval] Temp plan dir: ${planDir}`);

  const adapter = await createAdapter();
  const logger = createAutopilotLogger({ cwd: planDir, level: "warn" });
  const emitter = new SessionEventEmitter();

  let totalCost = 0;
  emitter.on("event", (event: { type: string; cumulativeCostUsd?: number }) => {
    if (event.type === "cost:update" && event.cumulativeCostUsd !== undefined) {
      totalCost = event.cumulativeCostUsd;
    }
  });

  const startTime = Date.now();

  try {
    console.error("[eval] Running enrichment...");
    await enrichPlan(
      REPO_ROOT,
      planDir,
      logger,
      emitter,
      adapter,
      undefined,
      {
        adapter: "claude-code-cli",
        models: { enrichment: "claude-opus-4-7" },
      },
    );
    console.error("[eval] Enrichment complete.");
  } catch (err) {
    console.error(`[eval] Enrichment failed: ${err}`);
  }

  const durationS = (Date.now() - startTime) / 1000;

  await logger.flush().catch(() => {});

  const result = scoreEnrichment(planDir, REPO_ROOT, totalCost, durationS);
  console.log(JSON.stringify(result, null, 2));
  console.error(`[eval] Score: ${result.score.toFixed(3)} (accuracy=${result.accuracy.toFixed(3)}, cost=$${totalCost.toFixed(4)}, time=${durationS.toFixed(0)}s)`);

  if (process.env["EVAL_KEEP_OUTPUT"]) {
    console.error(`[eval] Output kept at: ${planDir}`);
  } else {
    fs.rmSync(path.dirname(planDir), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[eval] Fatal: ${err}`);
  process.exit(1);
});
