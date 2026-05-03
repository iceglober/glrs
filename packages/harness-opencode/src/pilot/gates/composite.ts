/**
 * Composite-gate evaluators.
 *
 *  - `all`: evaluates sub-gates in order, short-circuits on first
 *    failure. Models today's verify-list semantics (run command 1,
 *    then 2, then 3; stop at the first non-zero exit).
 *  - `any`: evaluates sub-gates in order, short-circuits on first
 *    pass. Reserved for future use (e.g. "this AC can be verified
 *    by EITHER a shell test OR an LLM check"). Included now so the
 *    Gate union is shape-stable.
 */

import { evalGate } from "./eval.js";
import type {
  AllGate,
  AnyGate,
  CompositeEvidence,
  GateContext,
  GateResult,
} from "./types.js";

export async function evalAllGate(
  gate: AllGate,
  ctx: GateContext,
): Promise<GateResult> {
  const startedAt = Date.now();
  const results: CompositeEvidence["results"][number][] = [];

  for (const sub of gate.gates) {
    const subResult = await evalGate(sub, ctx);
    results.push({ gate: sub, result: subResult });
    if (!subResult.ok) {
      const evidence: CompositeEvidence = {
        kind: "all",
        results,
        failure: subResult,
      };
      return {
        ok: false,
        reason: subResult.reason,
        evidence,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const evidence: CompositeEvidence = { kind: "all", results };
  return {
    ok: true,
    evidence,
    durationMs: Date.now() - startedAt,
  };
}

export async function evalAnyGate(
  gate: AnyGate,
  ctx: GateContext,
): Promise<GateResult> {
  const startedAt = Date.now();
  const results: CompositeEvidence["results"][number][] = [];

  // Empty `any` is a degenerate case: there's no sub-gate to pass, so
  // it can't satisfy the "at least one passes" contract. Treat as fail
  // with an explanatory reason rather than vacuously passing.
  if (gate.gates.length === 0) {
    const evidence: CompositeEvidence = { kind: "any", results };
    return {
      ok: false,
      reason: "any-gate has no sub-gates to satisfy",
      evidence,
      durationMs: Date.now() - startedAt,
    };
  }

  let lastResult: GateResult | null = null;
  for (const sub of gate.gates) {
    const subResult = await evalGate(sub, ctx);
    results.push({ gate: sub, result: subResult });
    lastResult = subResult;
    if (subResult.ok) {
      const evidence: CompositeEvidence = { kind: "any", results };
      return {
        ok: true,
        evidence,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const evidence: CompositeEvidence = {
    kind: "any",
    results,
    failure: lastResult ?? undefined,
  };
  return {
    ok: false,
    reason: `any-gate exhausted: all ${results.length} sub-gates failed`,
    evidence,
    durationMs: Date.now() - startedAt,
  };
}
