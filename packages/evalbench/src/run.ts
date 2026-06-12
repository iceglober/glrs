/**
 * run — execute one fixture once against one model/config.
 *
 *   bun src/run.ts --fixture triage-gen2849 --model google-vertex/gemini-3.5-flash
 *
 * Output: eval-runs/<fixture>/<stamp>/ with session.md, final-answer.md,
 * run.json (metrics + deterministic checks), mutations summary. Exit 0 even on
 * a failed run — run.json carries the verdict; non-zero only for infra errors.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { validateManifest, validateRubric, type FixtureManifest } from "./manifest.js";
import {
  GLRS_ROOT,
  resolveFixtureDir,
  createWorktree,
  removeWorktree,
  assembleXdg,
  writeWorktreeConfig,
  readMutations,
} from "./sandbox.js";

// ---- args ----------------------------------------------------------------------

const argv = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}

export interface RunMetrics {
  fixture: string;
  model: string;
  prompt_override: string | null;
  terminal_state: string;
  wall_s: number;
  tool_calls: number;
  duplicate_calls: number;
  guard_fires: number;
  dead_turn_nudges: number;
  cost_usd: number;
  assistant_turns: number;
  final_text_chars: number;
  mutations: { tool: string; args: unknown }[];
  checks: { name: string; pass: boolean; detail?: string }[];
  checks_pass: boolean;
}

// ---- transcript rendering (ported from the GEN-2849 lab rig) ---------------------

interface Msg {
  info: {
    role: string;
    modelID?: string;
    time?: { created?: number; completed?: number };
    cost?: number;
  };
  parts: { type: string; text?: string; tool?: string; state?: { input?: unknown; output?: string; status?: string } }[];
}

export function renderTranscript(
  messages: Msg[],
  header: string,
): { md: string; callSigs: string[]; guardFires: number; deadTurnNudges: number; finalText: string; cost: number; turns: number } {
  let md = `${header}\n\n---\n`;
  const callSigs: string[] = [];
  let guardFires = 0;
  let deadTurnNudges = 0;
  let finalText = "";
  let cost = 0;
  let turns = 0;

  for (const m of messages) {
    const dur =
      m.info.time?.completed && m.info.time?.created
        ? ` · ${((m.info.time.completed - m.info.time.created) / 1000).toFixed(1)}s`
        : "";
    md += `\n## ${m.info.role === "assistant" ? `Assistant (${m.info.modelID ?? "?"}${dur})` : "User"}\n\n`;
    if (m.info.role === "assistant") turns++;
    cost += m.info.cost ?? 0;
    for (const p of m.parts ?? []) {
      if (p.type === "text" && p.text) {
        md += `${p.text}\n\n`;
        if (m.info.role === "assistant") finalText = p.text;
        if (m.info.role === "user" && p.text.startsWith("Your last turn ended after internal reasoning only")) {
          deadTurnNudges++;
        }
      } else if (p.type === "reasoning" && p.text) {
        md += `_Thinking:_ ${p.text.slice(0, 600)}${p.text.length > 600 ? "…" : ""}\n\n`;
      } else if (p.type === "tool") {
        const input = JSON.stringify(p.state?.input ?? {});
        callSigs.push(`${p.tool}:${input}`);
        const out = String(p.state?.output ?? "");
        guardFires += (out.match(/--- LOOP WARNING/g) ?? []).length;
        md += `**Tool: ${p.tool}** [${p.state?.status ?? "?"}]\n\nInput: \`${input.slice(0, 400)}\`\n\nOutput (${out.length}ch): \`\`\`\n${out.slice(0, 1500)}${out.length > 1500 ? "\n…[truncated]" : ""}\n\`\`\`\n\n`;
      }
    }
  }
  return { md, callSigs, guardFires, deadTurnNudges, finalText, cost, turns };
}

// ---- deterministic checks ----------------------------------------------------------

export function runChecks(
  manifest: FixtureManifest,
  finalText: string,
  worktree: string,
): { name: string; pass: boolean; detail?: string }[] {
  const checks: { name: string; pass: boolean; detail?: string }[] = [];
  const c = manifest.checks ?? {};
  if (c.requireFinalAnswer !== false) {
    checks.push({
      name: "final-answer-present",
      pass: finalText.trim().length >= 200,
      detail: `${finalText.trim().length} chars`,
    });
  }
  for (const pattern of c.finalAnswerMustMatch ?? []) {
    checks.push({
      name: `final-answer~/${pattern}/i`,
      pass: new RegExp(pattern, "i").test(finalText),
    });
  }
  if (c.verifyCommand) {
    try {
      execFileSync("bash", ["-lc", c.verifyCommand], {
        cwd: worktree,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5 * 60_000,
      });
      checks.push({ name: "verify-command", pass: true });
    } catch (err) {
      const tail = String((err as { stdout?: string; stderr?: string }).stdout ?? "")
        .split("\n")
        .slice(-5)
        .join("\n");
      checks.push({ name: "verify-command", pass: false, detail: tail.slice(0, 400) });
    }
  }
  return checks;
}

// ---- main -----------------------------------------------------------------------

async function main(): Promise<void> {
  const fixtureName = arg("fixture");
  const model = arg("model");
  if (!fixtureName || !model) {
    console.error("usage: run.ts --fixture <name> --model <provider/model> [--budget-min N] [--out dir]");
    process.exit(2);
  }
  const fixtureDir = resolveFixtureDir(fixtureName);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8")) as unknown;
  validateManifest(manifest);
  validateRubric(JSON.parse(fs.readFileSync(path.join(fixtureDir, "rubric.json"), "utf8")));
  const task = fs.readFileSync(path.join(fixtureDir, "task.md"), "utf8");
  const budgetMin = Number(arg("budget-min", String(manifest.budgetMin)));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir =
    arg("out") ?? path.join(GLRS_ROOT, "eval-runs", fixtureName, `${stamp}-${model.split("/").pop()}`);
  fs.mkdirSync(runDir, { recursive: true });

  const linearDir = path.join(fixtureDir, "linear");
  const wt = createWorktree(runDir, manifest.repo.source, manifest.repo.ref, manifest.repo.setup);
  writeWorktreeConfig(wt, runDir, { mockLinear: manifest.mockLinear, fixtureLinearDir: linearDir });
  const xdg = assembleXdg(runDir, { mockLinear: manifest.mockLinear });

  process.env["XDG_CONFIG_HOME"] = xdg;
  process.env["GLRS_AUTOPILOT_HEADLESS"] = "1";
  const denylist = [...(manifest.extraDenyTools ?? [])];
  if (denylist.length > 0) process.env["GLRS_TOOL_DENYLIST"] = denylist.join(",");
  process.chdir(wt);

  const { startServer, createSession, sendAndWait } = await import(
    `${GLRS_ROOT}/packages/adapter-opencode/src/opencode-adapter.ts`
  );

  // --override-prompt: replace prime's prompt wholesale (e.g. the
  // null-hypothesis "vanilla" two-line prompt). applyAgentOverrides requires
  // repo-root-relative paths, so copy the file into the throwaway worktree.
  const overridePromptSrc = arg("override-prompt");
  let promptOverride: { prompt: string } | Record<string, never> = {};
  if (overridePromptSrc) {
    fs.copyFileSync(overridePromptSrc, path.join(wt, ".evalbench-prompt.md"));
    promptOverride = { prompt: ".evalbench-prompt.md" };
  }

  const started = Date.now();
  const server = await startServer({ cwd: wt, agentOverrides: { prime: { model, ...promptOverride } } });
  const client = server.client;
  let terminal = "resolved";

  try {
    const sessionId = await createSession(client, { cwd: wt });
    console.error(`[run] ${fixtureName} session ${sessionId} model ${model} budget ${budgetMin}m`);

    const kill = new Promise<{ kind: string }>((resolve) => {
      const t = setTimeout(async () => {
        try {
          await client.session.abort({ path: { id: sessionId } });
        } catch {}
        resolve({ kind: "killed" });
      }, budgetMin * 60_000);
      (t as { unref?: () => void }).unref?.();
    });

    let result: { kind: string } = await Promise.race([
      sendAndWait(client, {
        sessionId,
        message: task,
        agentName: "prime",
        stallMs: budgetMin * 60_000,
        autoRejectPermissions: true,
        onToolCall: (tool: string) =>
          console.error(`[tool +${Math.round((Date.now() - started) / 1000)}s] ${tool}`),
      }),
      kill,
    ]);

    // Stability polling: a dead-turn nudge can resume an apparently-finished
    // session; finish only when the tail is a completed assistant turn that
    // stays unchanged for 3 consecutive polls.
    if (result.kind === "idle") {
      let stable = 0;
      let lastSig = "";
      while (Date.now() - started < budgetMin * 60_000) {
        await new Promise((r) => setTimeout(r, 5000));
        const peek = await client.session.messages({ path: { id: sessionId } });
        const data = (peek.data ?? []) as Msg[];
        const last = data[data.length - 1];
        if (!last) break;
        const sig = `${data.length}:${last.info.role}:${last.info.time?.completed ?? "open"}`;
        const settled = last.info.role === "assistant" && last.info.time?.completed != null;
        if (settled && sig === lastSig) {
          if (++stable >= 3) break;
        } else {
          stable = 0;
        }
        lastSig = sig;
      }
      if (Date.now() - started >= budgetMin * 60_000) result = { kind: "killed" };
    }
    terminal = result.kind === "idle" ? "resolved" : result.kind;

    const msgs = await client.session.messages({ path: { id: sessionId } });
    const messages = (msgs.data ?? []) as Msg[];
    const r = renderTranscript(
      messages,
      `# evalbench run — ${fixtureName}\n\nModel: ${model}\nTerminal: ${terminal}`,
    );

    const mutations = readMutations(runDir);
    // Executed tracker write-backs count toward the resolution: the regex
    // checks scan final answer + mutation payloads, and the panel sees the
    // mutations appended to the transcript.
    const mutationText = mutations.map((m) => `${m.tool}: ${JSON.stringify(m.args)}`).join("\n");
    if (mutations.length > 0) {
      r.md += `\n\n## Recorded tracker mutations (mock — nothing was written)\n\n\`\`\`\n${mutationText.slice(0, 4000)}\n\`\`\`\n`;
    }
    const checks = runChecks(manifest, `${r.finalText}\n${mutationText}`, wt);
    const metrics: RunMetrics = {
      fixture: fixtureName,
      model,
      prompt_override: overridePromptSrc ? path.basename(overridePromptSrc) : null,
      terminal_state: terminal,
      wall_s: Math.round((Date.now() - started) / 1000),
      tool_calls: r.callSigs.length,
      duplicate_calls: r.callSigs.length - new Set(r.callSigs).size,
      guard_fires: r.guardFires,
      dead_turn_nudges: r.deadTurnNudges,
      cost_usd: Number(r.cost.toFixed(4)),
      assistant_turns: r.turns,
      final_text_chars: r.finalText.length,
      mutations,
      checks,
      checks_pass: checks.every((c) => c.pass),
    };

    fs.writeFileSync(path.join(runDir, "session.md"), r.md);
    fs.writeFileSync(path.join(runDir, "final-answer.md"), r.finalText || "(no final text)");
    fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify({ runDir, ...metrics, mutations: mutations.length }));
  } finally {
    await server.shutdown();
    removeWorktree(manifest.repo.source, runDir);
  }
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[run] infra error: ${err?.message ?? err}`);
    process.exit(1);
  });
}
