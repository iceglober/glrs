/**
 * score — blind-evaluator panel for a completed run.
 *
 *   bun src/score.ts --run eval-runs/<fixture>/<stamp> [--evaluators 3] [--model azure/deepseek-v4-pro]
 *
 * Each evaluator is a fresh, locked-down `council-member` session (pure
 * completion, no tools — shipped with the harness) that sees ONLY: the rubric,
 * the fixture's ground truth, and the transcript. Composites are recomputed
 * locally from per-criterion scores (models do arithmetic badly); the panel
 * score is the MEDIAN; divergence > 20% of scale is flagged.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateRubric, type Rubric } from "./manifest.js";
import { GLRS_ROOT, assembleXdg } from "./sandbox.js";

const argv = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}

export function buildEvaluatorPrompt(rubric: Rubric, groundTruth: string, transcript: string): string {
  const criteria = rubric.criteria
    .map((c) => `- ${c.key} (weight ${c.weight}): ${c.definition}`)
    .join("\n");
  // Bound the transcript: keep head and tail, drop the middle.
  const MAX = 90_000;
  const t =
    transcript.length <= MAX
      ? transcript
      : `${transcript.slice(0, MAX * 0.6)}\n\n…[middle truncated]…\n\n${transcript.slice(-MAX * 0.4)}`;
  return `You are a blind evaluator scoring an AI agent's session transcript.

GROUND TRUTH (what a correct run contains):
${groundTruth}

RUBRIC — score each criterion 1-${rubric.scaleMax} (${rubric.scaleMax} = perfect):
${criteria}

TRANSCRIPT:
${t}

Respond with ONLY a JSON object: {${rubric.criteria.map((c) => `"${c.key}": n`).join(", ")}, "one_line_justification": "..."} — no prose, no markdown fences.`;
}

/** Extract the first JSON object from model output (fences/prose tolerated). */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  for (let end = text.length; end > start; end--) {
    try {
      return JSON.parse(text.slice(start, end)) as Record<string, unknown>;
    } catch {
      /* shrink */
    }
  }
  return null;
}

export function composite(rubric: Rubric, scores: Record<string, unknown>): number | null {
  let total = 0;
  for (const c of rubric.criteria) {
    const v = Number(scores[c.key]);
    if (!Number.isFinite(v) || v < 1 || v > rubric.scaleMax) return null;
    total += v * c.weight;
  }
  return Number(total.toFixed(2));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Number((((s[mid - 1]! + s[mid]!) / 2)).toFixed(2));
}

async function main(): Promise<void> {
  const runDir = arg("run");
  if (!runDir) {
    console.error("usage: score.ts --run <run-dir> [--evaluators 3] [--model <id>]");
    process.exit(2);
  }
  const nEval = Number(arg("evaluators", "3"));
  const model = arg("model", "azure/deepseek-v4-pro")!;

  const runJson = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8")) as { fixture: string };
  const fixtureDir = path.join(GLRS_ROOT, "packages", "evalbench", "fixtures", runJson.fixture);
  const rubric = JSON.parse(fs.readFileSync(path.join(fixtureDir, "rubric.json"), "utf8")) as Rubric;
  validateRubric(rubric);
  const groundTruth = fs.readFileSync(path.join(fixtureDir, "ground-truth.md"), "utf8");
  const transcript = fs.readFileSync(path.join(runDir, "session.md"), "utf8");
  const prompt = buildEvaluatorPrompt(rubric, groundTruth, transcript);

  // One server, N fresh sessions — evaluators share no conversation state.
  const scoreDir = path.join(runDir, "score");
  fs.rmSync(scoreDir, { recursive: true, force: true });
  fs.mkdirSync(scoreDir, { recursive: true });
  const scoreXdg = assembleXdg(scoreDir, { mockLinear: false });
  process.env["XDG_CONFIG_HOME"] = scoreXdg;
  process.env["GLRS_AUTOPILOT_HEADLESS"] = "1";
  // Server project = the glrs repo (a real git dir). Pointing the project at
  // the non-git run directory produced empty completions with no error.
  process.chdir(GLRS_ROOT);

  const { startServer, createSession } = await import(
    `${GLRS_ROOT}/packages/adapter-opencode/src/opencode-adapter.ts`
  );
  const server = await startServer({ cwd: GLRS_ROOT, agentOverrides: { "council-member": { model } } });
  const client = server.client;

  const evaluations: { scores: Record<string, unknown>; composite: number }[] = [];
  try {
    for (let i = 0; i < nEval; i++) {
      // Direct session.prompt, NOT sendAndWait: a tool-less completion
      // finishes before waitForIdle's event subscription is live, so the
      // event-driven path reports a stall on perfectly good responses.
      const sessionId = await createSession(client, { cwd: GLRS_ROOT });
      const res = (await Promise.race([
        client.session.prompt({
          path: { id: sessionId },
          body: { parts: [{ type: "text", text: prompt }], agent: "council-member" },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("evaluator timeout")), 5 * 60_000)),
      ])) as { data?: { info?: { error?: unknown }; parts?: { type: string; text?: string }[] } };
      const err = res.data?.info?.error;
      const text = (res.data?.parts ?? [])
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n");
      const parsed = text ? extractJson(text) : null;
      const comp = parsed ? composite(rubric, parsed) : null;
      if (parsed && comp !== null) {
        evaluations.push({ scores: parsed, composite: comp });
        console.error(`[score] evaluator ${i + 1}: ${comp}`);
      } else {
        console.error(
          `[score] evaluator ${i + 1}: unparseable — err=${JSON.stringify(err ?? null)?.slice(0, 150)} text=${text.slice(0, 100)}`,
        );
      }
    }
  } finally {
    await server.shutdown();
  }

  if (evaluations.length === 0) {
    console.error("[score] no valid evaluations");
    process.exit(1);
  }
  const composites = evaluations.map((e) => e.composite);
  const med = median(composites);
  const divergent = composites.some((c) => Math.abs(c - med) > rubric.scaleMax * 0.2);
  const out = {
    median: med,
    composites,
    divergent,
    evaluator_model: model,
    evaluations,
  };
  fs.writeFileSync(path.join(runDir, "score.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ median: med, composites, divergent }));
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[score] infra error: ${err?.message ?? err}`);
    process.exit(1);
  });
}
