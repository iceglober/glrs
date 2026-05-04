/**
 * Top-level gate dispatcher. Branches on `gate.kind`, calls the
 * corresponding evaluator, returns its `GateResult`.
 *
 * Future kinds (`llm`, `approval`) are added by widening the Gate
 * union in types.ts and adding a branch here. Step 1 of the redesign
 * ships only `shell` and composites.
 */

import { evalAllGate, evalAnyGate } from "./composite.js";
import { evalShellGate } from "./shell.js";
import type { Gate, GateContext, GateResult } from "./types.js";

export async function evalGate(
  gate: Gate,
  ctx: GateContext,
): Promise<GateResult> {
  switch (gate.kind) {
    case "shell":
      return evalShellGate(gate, ctx);
    case "all":
      return evalAllGate(gate, ctx);
    case "any":
      return evalAnyGate(gate, ctx);
    default: {
      const _exhaustive: never = gate;
      throw new Error(
        `evalGate: unknown gate kind ${(_exhaustive as { kind?: unknown }).kind}`,
      );
    }
  }
}
