/**
 * suite — run fixtures × repetitions against a model, score everything, report.
 *
 *   bun src/suite.ts --model google-vertex/gemini-3.5-flash [--fixtures a,b] [--runs 1] [--evaluator-model azure/deepseek-v4-pro]
 *
 * Appends one TSV row per run to eval-runs/results.tsv and prints a summary
 * table. Sequential by design: parallel runs would contend for provider quota
 * and confound wall-time metrics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { GLRS_ROOT, listFixtures } from "./sandbox.js";

const argv = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}

const RESULTS = path.join(GLRS_ROOT, "eval-runs", "results.tsv");
const HEADER =
  "ts\tfixture\tmodel\tharness_rev\tmedian\tchecks_pass\tterminal\twall_s\ttool_calls\tdup\tguards\tcost_usd\tmutations\trun_dir\n";

function lastJsonLine(out: string): Record<string, unknown> {
  const lines = out.trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const model = arg("model");
  if (!model) {
    console.error("usage: suite.ts --model <id> [--fixtures a,b] [--runs N] [--evaluator-model <id>]");
    process.exit(2);
  }
  const runs = Number(arg("runs", "1"));
  const evaluatorModel = arg("evaluator-model", "azure/deepseek-v4-pro")!;
  const fixtures = arg("fixtures")?.split(",").map((s) => s.trim()) ?? listFixtures();

  const harnessRev = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: GLRS_ROOT,
    encoding: "utf8",
  }).trim();

  fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
  if (!fs.existsSync(RESULTS)) fs.writeFileSync(RESULTS, HEADER);

  const summary: string[] = [];
  for (const fixture of fixtures) {
    for (let i = 0; i < runs; i++) {
      console.error(`\n=== ${fixture} run ${i + 1}/${runs} (${model}) ===`);
      let runOut: Record<string, unknown>;
      try {
        runOut = lastJsonLine(
          execFileSync("bun", [path.join(GLRS_ROOT, "packages", "evalbench", "src", "run.ts"),
            "--fixture", fixture, "--model", model], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"],
            timeout: 40 * 60_000,
          }),
        );
      } catch (err) {
        console.error(`[suite] ${fixture} run failed: ${(err as Error).message?.slice(0, 200)}`);
        continue;
      }
      const runDir = String(runOut["runDir"]);
      let med = "";
      try {
        const scoreOut = lastJsonLine(
          execFileSync("bun", [path.join(GLRS_ROOT, "packages", "evalbench", "src", "score.ts"),
            "--run", runDir, "--model", evaluatorModel], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "inherit"],
            timeout: 15 * 60_000,
          }),
        );
        med = String(scoreOut["median"]);
      } catch (err) {
        console.error(`[suite] ${fixture} scoring failed: ${(err as Error).message?.slice(0, 200)}`);
      }
      const row = [
        new Date().toISOString(),
        fixture,
        model,
        harnessRev,
        med || "NA",
        String(runOut["checks_pass"]),
        String(runOut["terminal_state"]),
        String(runOut["wall_s"]),
        String(runOut["tool_calls"]),
        String(runOut["duplicate_calls"]),
        String(runOut["guard_fires"]),
        String(runOut["cost_usd"]),
        String(runOut["mutations"]),
        runDir,
      ].join("\t");
      fs.appendFileSync(RESULTS, row + "\n");
      summary.push(
        `${fixture.padEnd(26)} median=${(med || "NA").padEnd(5)} checks=${runOut["checks_pass"]} ` +
          `wall=${runOut["wall_s"]}s calls=${runOut["tool_calls"]} cost=$${runOut["cost_usd"]}`,
      );
    }
  }
  console.log(`\nharness ${harnessRev} · model ${model}\n` + summary.join("\n"));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[suite] ${err?.message ?? err}`);
    process.exit(1);
  });
}
