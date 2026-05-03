/**
 * Gate types — the polymorphic primitive for "did this work?".
 *
 * A Gate is a declarative description of a check; an evaluator
 * (`evalGate` in ./eval.ts) turns it into a `GateResult`. The result
 * carries enough structured evidence that the worker, the CLI, and
 * future LLM-driven phases (qa, scope) can all consume it uniformly.
 *
 * Step 1 of the redesign (see ADR §3) ships the `shell` and composite
 * (`all` / `any`) kinds. Steps 4 and 6 widen this union with `llm`
 * and `approval` kinds; the discriminated-union shape is designed so
 * those additions are non-breaking.
 *
 * Why evidence is `unknown` at the type level:
 *   - Each gate kind produces structurally different evidence (a
 *     CommandResult for shell, a child-result list for composite, a
 *     parsed model response for llm). Pinning evidence to a per-kind
 *     type would force every consumer to discriminate; pinning it to
 *     a single shape would force lossy projection. `unknown` keeps
 *     producers honest about what they emit and pushes the
 *     discriminate-and-narrow burden onto consumers that actually
 *     need it (today: the verify runner shim).
 */

import type { CommandResult } from "../verify/spawn.js";

// --- Gate union ------------------------------------------------------------

/** Run a single shell command. Pass iff exit code is 0. */
export type ShellGate = {
  readonly kind: "shell";
  readonly command: string;
  readonly timeoutMs?: number;
};

/** Composite — pass iff every sub-gate passes. Short-circuits on first fail. */
export type AllGate = {
  readonly kind: "all";
  readonly gates: ReadonlyArray<Gate>;
};

/** Composite — pass iff any sub-gate passes. Short-circuits on first pass. */
export type AnyGate = {
  readonly kind: "any";
  readonly gates: ReadonlyArray<Gate>;
};

export type Gate = ShellGate | AllGate | AnyGate;

// --- Result --------------------------------------------------------------

export type GatePass = {
  readonly ok: true;
  /** Per-kind evidence. See evidence.ts helpers for typed narrowing. */
  readonly evidence: unknown;
  /** Wall time of the gate evaluation in ms. */
  readonly durationMs: number;
};

export type GateFail = {
  readonly ok: false;
  /** One-line human-readable reason. Always present, never empty. */
  readonly reason: string;
  /** Per-kind evidence. See evidence.ts helpers for typed narrowing. */
  readonly evidence: unknown;
  readonly durationMs: number;
};

export type GateResult = GatePass | GateFail;

// --- Evaluation context --------------------------------------------------

/**
 * Inputs an evaluator needs that are NOT part of the gate definition.
 *
 * Today: shell-gate cwd/env/abort + line streaming. Future kinds will
 * extend this (an `llm` gate needs an opencode client; an `approval`
 * gate needs a TTY prompt fn). Adding optional fields here is
 * non-breaking; the shell evaluator ignores fields it doesn't care
 * about, and vice versa.
 */
export type GateContext = {
  /** Working directory. Required for shell gates; ignored by others. */
  readonly cwd: string;

  /** Environment overrides for shell gates. Defaults to process.env. */
  readonly env?: NodeJS.ProcessEnv;

  /** Cancellation. All evaluators honor this. */
  readonly abortSignal?: AbortSignal;

  /**
   * Per-line callback for shell-gate output. Same shape as
   * RunVerifyOptions.onLine — used by the worker to write JSONL logs.
   */
  readonly onShellLine?: (args: {
    stream: "stdout" | "stderr";
    line: string;
    command: string;
  }) => void;

  /**
   * Maximum captured shell output per command. Default 256KB
   * (matches DEFAULT_OUTPUT_CAP_BYTES in verify/runner.ts). Excess
   * is truncated with a sentinel.
   */
  readonly shellOutputCapBytes?: number;
};

// --- Typed evidence helpers ----------------------------------------------

/** The evidence emitted by a shell gate. */
export type ShellEvidence = {
  readonly kind: "shell";
  readonly result: CommandResult;
};

/** The evidence emitted by a composite (all/any) gate. */
export type CompositeEvidence = {
  readonly kind: "all" | "any";
  /** Sub-gate results in evaluation order. May be partial on short-circuit. */
  readonly results: ReadonlyArray<{
    readonly gate: Gate;
    readonly result: GateResult;
  }>;
  /**
   * For an `all` failure, the first failing sub-result. For an `any`
   * failure (every sub-gate failed), the last sub-result. Absent on
   * pass (caller should consult `results`).
   */
  readonly failure?: GateResult;
};

/**
 * Type guard — narrow GateResult evidence to ShellEvidence. Use when
 * the caller knows the gate was a shell gate (e.g. the verify-runner
 * shim that constructs only shell gates).
 */
export function asShellEvidence(evidence: unknown): ShellEvidence | null {
  if (
    typeof evidence === "object" &&
    evidence !== null &&
    (evidence as { kind?: unknown }).kind === "shell"
  ) {
    return evidence as ShellEvidence;
  }
  return null;
}

/** Type guard — narrow GateResult evidence to CompositeEvidence. */
export function asCompositeEvidence(
  evidence: unknown,
): CompositeEvidence | null {
  if (
    typeof evidence === "object" &&
    evidence !== null &&
    ((evidence as { kind?: unknown }).kind === "all" ||
      (evidence as { kind?: unknown }).kind === "any")
  ) {
    return evidence as CompositeEvidence;
  }
  return null;
}
