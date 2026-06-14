/**
 * delegate-quality — two-stage measurement of delegation value.
 *
 *   bun src/delegate-quality.ts --fixture <f> --delegate <model> --primary <model>
 *
 * Stage 1: a (cheap) DELEGATE model localizes the code relevant to the task and
 *          returns only the locations — its context is then thrown away.
 * Stage 2: the (strong) PRIMARY model completes the task in the SAME worktree,
 *          seeded with the delegate's output (so it need not re-search).
 * Score: the fixture's verify oracle on the resulting worktree.
 *
 * The real question a delegate answers is not "is it flawless" but "does a
 * strong primary SUCCEED given its output, at lower total cost than the primary
 * doing the whole thing alone". Compare this run's total cost+pass against the
 * primary-alone baseline (a normal run.ts run of --primary).
 *
 * Isolation: per-run XDG + throwaway clone, exactly like run.ts. Never writes
 * the global opencode config.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  GLRS_ROOT, resolveFixtureDir, createWorktree, removeWorktree,
  assembleXdg, writeWorktreeConfig,
} from "./sandbox.js";
import { renderTranscript, runChecks, checksPass } from "./run.js";

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const fixtureName = arg("fixture");
const delegateModel = arg("delegate");
const primaryModel = arg("primary");
if (!fixtureName || !delegateModel || !primaryModel) {
  console.error("usage: --fixture <f> --delegate <model> --primary <model>");
  process.exit(2);
}

const fixtureDir = resolveFixtureDir(fixtureName);
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8"));
const task = fs.readFileSync(path.join(fixtureDir, "task.md"), "utf8");
const budgetMin = Number(arg("budget-min", String(manifest.budgetMin)));

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(GLRS_ROOT, "eval-runs", `dq-${fixtureName}`,
  `${stamp}-${delegateModel.split("/").pop()}__${primaryModel.split("/").pop()}`);
fs.mkdirSync(runDir, { recursive: true });

const DELEGATE_PROMPT = manifest.delegateTask ??
  `You are a code-search delegate. Do NOT change any code. Locate the code relevant to the task below and report ONLY: the file path(s), the specific function(s)/symbol(s), and the key line(s) that a developer would need to edit or read to do it. Be precise and complete; your output is the sole context another engineer will use.\n\n--- TASK ---\n${task}`;

const wt = createWorktree(runDir, manifest.repo.source, manifest.repo.ref, manifest.repo.setup);
writeWorktreeConfig(wt, runDir, { mockLinear: !!manifest.mockLinear, fixtureLinearDir: path.join(fixtureDir, "linear") });
const xdg = assembleXdg(runDir, { mockLinear: !!manifest.mockLinear });
process.env["XDG_CONFIG_HOME"] = xdg;
process.env["GLRS_AUTOPILOT_HEADLESS"] = "1";
process.chdir(wt);

const { startServer, createSession, sendAndWait } = await import(`${GLRS_ROOT}/packages/adapter-opencode/src/opencode-adapter.ts`);

interface Msg { info: { role: string; modelID?: string; time?: { created?: number; completed?: number }; cost?: number }; parts: any[] }

async function drive(client: any, model: string, message: string): Promise<{ md: string; finalText: string; cost: number; calls: number }> {
  const sid = await createSession(client, { cwd: wt });
  const started = Date.now();
  const kill = new Promise<{ kind: string }>((r) => { const t = setTimeout(() => r({ kind: "killed" }), budgetMin * 60_000); (t as any).unref?.(); });
  let res: { kind: string } = await Promise.race([
    sendAndWait(client, { sessionId: sid, message, agentName: "prime", model, stallMs: budgetMin * 60_000, autoRejectPermissions: true,
      onToolCall: (t: string) => console.error(`  [${model.split("/").pop()} +${Math.round((Date.now()-started)/1000)}s] ${t}`) }),
    kill,
  ]);
  // stability poll for harness-injected resumes (dead-turn nudges)
  if (res.kind === "idle") {
    let stable = 0, last = "";
    while (Date.now() - started < budgetMin * 60_000) {
      await new Promise((r) => setTimeout(r, 5000));
      const peek = await client.session.messages({ path: { id: sid } });
      const data = (peek.data ?? []) as Msg[]; const m = data[data.length - 1];
      if (!m) break;
      const sig = `${data.length}:${m.info.role}:${m.info.time?.completed ?? "open"}`;
      if (m.info.role === "assistant" && m.info.time?.completed != null && sig === last) { if (++stable >= 3) break; } else stable = 0;
      last = sig;
    }
  }
  const msgs = await client.session.messages({ path: { id: sid } });
  const r = renderTranscript((msgs.data ?? []) as any, `# ${model}`);
  return { md: r.md, finalText: r.finalText, cost: r.cost, calls: r.callSigs.length };
}

const server = await startServer({ cwd: wt });
const client = server.client;
let out: any;
try {
  console.error(`[dq] ${fixtureName}: delegate=${delegateModel} primary=${primaryModel}`);
  const s1 = await drive(client, delegateModel, DELEGATE_PROMPT);
  console.error(`[dq] stage1 (delegate) done: ${s1.calls} calls, $${s1.cost.toFixed(3)}, ${s1.finalText.length} chars out`);
  const seeded = `${task}\n\n--- A prior code-search delegate located the relevant code (trust it; do not re-search broadly) ---\n${s1.finalText}\n--- end delegate output ---\n\nUsing that, complete the task now and verify it.`;
  const s2 = await drive(client, primaryModel, seeded);
  console.error(`[dq] stage2 (primary) done: ${s2.calls} calls, $${s2.cost.toFixed(3)}`);

  const checks = runChecks(manifest, s2.finalText, wt);
  out = {
    fixture: fixtureName, delegate: delegateModel, primary: primaryModel,
    checks_pass: checksPass(checks), checks,
    delegate_cost: Number(s1.cost.toFixed(4)), delegate_calls: s1.calls,
    primary_cost: Number(s2.cost.toFixed(4)), primary_calls: s2.calls,
    total_cost: Number((s1.cost + s2.cost).toFixed(4)),
  };
  fs.writeFileSync(path.join(runDir, "stage1-delegate.md"), s1.md + "\n\n## FINAL\n" + s1.finalText);
  fs.writeFileSync(path.join(runDir, "stage2-primary.md"), s2.md);
  fs.writeFileSync(path.join(runDir, "dq.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
} finally {
  await server.shutdown();
  removeWorktree(manifest.repo.source, runDir);
}
process.exit(0);
