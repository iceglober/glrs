/**
 * diversify.ts — diversification ladder for the pilot retry engine.
 *
 * The diversification ladder escalates retry strategy based on attempt
 * number and failure class. Three modes:
 *
 *   none       — preserves current behavior (same strategy every attempt)
 *   standard   — adds critic + narrow-scope on escalating attempts
 *   aggressive — adds model-swap and fresh-subagent on later attempts
 *
 * Each escalation emits a `task.diversify.applied` event.
 *
 * This is a pure function — no I/O, no side effects (event emission is
 * the caller's responsibility via the returned action).
 */

import type { FailureClass } from "./classify.js";

// --- Types ------------------------------------------------------------------

/**
 * Diversification mode from the plan defaults.
 *
 *   none       — no diversification; same approach every attempt
 *   standard   — critic + narrow-scope escalation
 *   aggressive — adds model-swap and fresh-subagent
 */
export type DiversifyMode = "none" | "standard" | "aggressive";

/**
 * The action the engine should take for the next attempt.
 *
 *   same-strategy   — retry with the same approach (no changes)
 *   run-critic      — invoke the critic before the next attempt
 *   narrow-scope    — add scope-narrowing guidance to the fix prompt
 *   model-swap      — switch to the alt_model for the next attempt
 *   fresh-subagent  — tear down and recreate the session (placeholder)
 */
export type DiversifyAction =
  | "same-strategy"
  | "run-critic"
  | "narrow-scope"
  | "model-swap"
  | "fresh-subagent";

/**
 * Input to the diversification ladder.
 */
export interface DiversifyInput {
  /** Current attempt number (1-based). */
  attempt: number;
  /** Maximum number of attempts configured. */
  maxAttempts: number;
  /** The failure class from the classifier. */
  failureClass: FailureClass;
  /** The diversification mode from plan defaults. */
  mode: DiversifyMode;
}

/**
 * Result of the diversification ladder.
 */
export interface DiversifyResult {
  /** The action to take for the next attempt. */
  action: DiversifyAction;
  /**
   * Whether the critic should run before the next attempt.
   * True when action is "run-critic" or "narrow-scope".
   */
  runCritic: boolean;
  /**
   * Whether to use the alt_model for the next attempt.
   * True when action is "model-swap".
   */
  useAltModel: boolean;
  /**
   * Whether to create a fresh subagent session.
   * True when action is "fresh-subagent".
   * NOTE: This is a placeholder — full implementation requires session
   * teardown/recreation which is a separate concern.
   */
  freshSubagent: boolean;
}

// --- Ladder logic -----------------------------------------------------------

/**
 * Compute the diversification action for the next attempt.
 *
 * Ladder escalation by mode:
 *
 *   none:
 *     all attempts → same-strategy
 *
 *   standard:
 *     attempt 1 → same-strategy (first failure, just retry)
 *     attempt 2 → run-critic    (add targeted guidance)
 *     attempt 3+ → narrow-scope (add scope-narrowing)
 *     exception: transient failures always → same-strategy (no critic needed)
 *
 *   aggressive:
 *     attempt 1 → same-strategy
 *     attempt 2 → run-critic
 *     attempt 3 → narrow-scope
 *     attempt 4 → model-swap
 *     attempt 5+ → fresh-subagent
 *     exception: transient failures always → same-strategy
 *
 * @param input  The diversification input.
 * @returns      The diversification result.
 */
export function computeDiversify(input: DiversifyInput): DiversifyResult {
  const { attempt, failureClass, mode } = input;

  // Transient failures never need critic or escalation — just retry.
  const isTransient = failureClass === "transient";

  if (mode === "none" || isTransient) {
    return makeResult("same-strategy");
  }

  if (mode === "standard") {
    if (attempt <= 1) return makeResult("same-strategy");
    if (attempt === 2) return makeResult("run-critic");
    return makeResult("narrow-scope");
  }

  // aggressive
  if (attempt <= 1) return makeResult("same-strategy");
  if (attempt === 2) return makeResult("run-critic");
  if (attempt === 3) return makeResult("narrow-scope");
  if (attempt === 4) return makeResult("model-swap");
  return makeResult("fresh-subagent");
}

// --- Helpers ----------------------------------------------------------------

function makeResult(action: DiversifyAction): DiversifyResult {
  return {
    action,
    runCritic: action === "run-critic" || action === "narrow-scope",
    useAltModel: action === "model-swap",
    freshSubagent: action === "fresh-subagent",
  };
}
