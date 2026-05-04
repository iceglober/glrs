/**
 * Verify-command runner — legacy surface.
 *
 * Each task carries a `verify` list of shell commands. After the agent
 * reports done, the worker runs every command in order via `bash -c`.
 * The first command that fails (non-zero exit, signal kill, or
 * timeout) short-circuits the whole verify pass and the worker enters
 * the fix loop.
 *
 * As of step 1 of the pilot redesign (see ADR §3), this module is a
 * thin shim: `runVerify` builds an `all` composite gate of shell
 * gates and delegates to `evalGate`. The spawn primitive (`runOne`)
 * lives in ./spawn.ts and is re-exported here for callers that
 * predate the gate abstraction (worker, tests, future `pilot doctor`).
 *
 * Behavior is byte-identical to the pre-gate implementation: same
 * short-circuit-on-first-fail semantics, same CommandResult shapes,
 * same line-streaming, same timeouts. Future work moves callers
 * (the worker first) onto evalGate directly so this shim can be
 * deleted.
 */

import { evalGate } from "../gates/eval.js";
import {
  asCompositeEvidence,
  asShellEvidence,
  type CompositeEvidence,
  type Gate,
  type GateContext,
  type GateResult,
} from "../gates/types.js";

import {
  runOne,
  type CommandFailure,
  type CommandResult,
  type CommandSuccess,
  type RunVerifyOptions,
} from "./spawn.js";

// Re-exports — preserve the legacy public surface.
export { runOne };
export type {
  CommandFailure,
  CommandResult,
  CommandSuccess,
  RunVerifyOptions,
};

export type RunVerifyResult =
  | { ok: true; results: CommandSuccess[] }
  | {
      ok: false;
      results: CommandResult[]; // includes the failing command at the end
      failure: CommandFailure;
    };

// --- Public API ------------------------------------------------------------

/**
 * Run the given verify commands in order. Stops at the first failure
 * and returns a `RunVerifyResult`. On total success, runs every
 * command and returns `ok: true`.
 *
 * Empty `commands` array short-circuits to `ok: true` with an empty
 * results list — it's the worker's responsibility to decide what
 * "no verify" means semantically.
 *
 * Implementation: builds an `all` gate of shell sub-gates and calls
 * `evalGate`. The result is translated back to the legacy
 * RunVerifyResult shape so existing callers don't change.
 */
export async function runVerify(
  commands: ReadonlyArray<string>,
  options: RunVerifyOptions,
): Promise<RunVerifyResult> {
  if (commands.length === 0) {
    return { ok: true, results: [] };
  }

  const gate: Gate = {
    kind: "all",
    gates: commands.map((command) => ({
      kind: "shell" as const,
      command,
      timeoutMs: options.timeoutMs,
    })),
  };

  const ctx: GateContext = {
    cwd: options.cwd,
    env: options.env,
    abortSignal: options.abortSignal,
    onShellLine: options.onLine,
    shellOutputCapBytes: options.outputCapBytes,
  };

  const gateResult = await evalGate(gate, ctx);
  return toRunVerifyResult(gateResult);
}

// --- Internals -------------------------------------------------------------

function toRunVerifyResult(gateResult: GateResult): RunVerifyResult {
  const composite = asCompositeEvidence(gateResult.evidence);
  if (composite === null || composite.kind !== "all") {
    // Should be unreachable: runVerify always builds an `all` gate.
    throw new Error(
      `runVerify: expected composite all-gate evidence, got ${gateResultDescriptor(gateResult)}`,
    );
  }

  const results = composite.results.map((entry) => extractCommandResult(entry));

  if (gateResult.ok) {
    return {
      ok: true,
      results: results as CommandSuccess[],
    };
  }

  // The failing entry is always the last one in the results list (the
  // `all`-gate short-circuits on first failure, and the failing
  // sub-result is appended before returning).
  const failingEntry = composite.results[composite.results.length - 1];
  if (!failingEntry || failingEntry.result.ok) {
    throw new Error(
      "runVerify: all-gate failed but no failing sub-result was recorded",
    );
  }
  const failureCommandResult = extractCommandResult(failingEntry);
  if (failureCommandResult.ok) {
    throw new Error(
      "runVerify: failing sub-gate produced a successful CommandResult",
    );
  }
  return {
    ok: false,
    results,
    failure: failureCommandResult,
  };
}

function extractCommandResult(
  entry: CompositeEvidence["results"][number],
): CommandResult {
  const shell = asShellEvidence(entry.result.evidence);
  if (shell === null) {
    throw new Error(
      `runVerify: expected shell-gate evidence in all-gate child, got ${gateResultDescriptor(entry.result)}`,
    );
  }
  return shell.result;
}

function gateResultDescriptor(result: GateResult): string {
  const evidence = result.evidence as { kind?: unknown } | null;
  return JSON.stringify({
    ok: result.ok,
    evidenceKind: evidence?.kind ?? null,
  });
}
