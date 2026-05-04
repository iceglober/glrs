/**
 * Shell-gate evaluator. Wraps verify/runner.ts:runOne for a single
 * command, translating its CommandResult into a GateResult.
 *
 * The shim is deliberately thin: runOne already handles spawn,
 * timeout, abort, output capture, and line streaming. All this
 * evaluator does is shape-translate and produce a one-line `reason`
 * for the GateFail case.
 */

import { runOne, type CommandResult } from "../verify/spawn.js";
import type { GateContext, GateResult, ShellGate } from "./types.js";

export async function evalShellGate(
  gate: ShellGate,
  ctx: GateContext,
): Promise<GateResult> {
  const result = await runOne(gate.command, {
    cwd: ctx.cwd,
    env: ctx.env,
    abortSignal: ctx.abortSignal,
    onLine: ctx.onShellLine,
    timeoutMs: gate.timeoutMs,
    outputCapBytes: ctx.shellOutputCapBytes,
  });
  return toGateResult(result);
}

function toGateResult(result: CommandResult): GateResult {
  if (result.ok) {
    return {
      ok: true,
      durationMs: result.durationMs,
      evidence: { kind: "shell", result },
    };
  }
  const reason = formatShellFailure(result);
  return {
    ok: false,
    reason,
    durationMs: result.durationMs,
    evidence: { kind: "shell", result },
  };
}

function formatShellFailure(result: CommandResult & { ok: false }): string {
  const flags: string[] = [];
  if (result.timedOut) flags.push("timed-out");
  if (result.aborted) flags.push("aborted");
  if (result.signal) flags.push(`signal=${result.signal}`);
  const flagSuffix = flags.length > 0 ? ` [${flags.join(",")}]` : "";
  return `shell gate failed: ${result.command} → exit ${result.exitCode}${flagSuffix}`;
}
