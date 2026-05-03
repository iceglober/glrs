/**
 * Gates barrel — single import surface for the gate abstraction.
 *
 * See ADR §3 in plans/re-design-the-opencode-pilot. Step 1 ships
 * shell + composite kinds; llm and approval will widen the Gate
 * union in steps 4 and 6 without breaking this surface.
 */

export type {
  AllGate,
  AnyGate,
  CompositeEvidence,
  Gate,
  GateContext,
  GateFail,
  GatePass,
  GateResult,
  ShellEvidence,
  ShellGate,
} from "./types.js";
export { asCompositeEvidence, asShellEvidence } from "./types.js";
export { evalGate } from "./eval.js";
export { evalShellGate } from "./shell.js";
export { evalAllGate, evalAnyGate } from "./composite.js";
