/**
 * engine.ts — per-attempt retry orchestrator for the pilot worker.
 *
 * The engine is called AFTER a verify failure, BEFORE the next attempt.
 * It chains:
 *   classify → critic → diversify → retry-strategy → enriched fixPrompt
 *
 * The worker keeps session lifecycle, baseline verify, the outer attempt
 * counter, and post-task cleanup. The engine provides the retry intelligence.
 *
 * Architecture note:
 *   - The engine does NOT own the attempt loop.
 *   - The engine does NOT create or destroy sessions.
 *   - The engine returns what to do next: retry with enriched prompt,
 *     trip circuit breaker, or change strategy.
 */

import type { Database } from "bun:sqlite";
import { appendEvent } from "../state/events.js";
import { classifyFailure, type ClassifyLLMClient } from "./classify.js";
import { runCritic, type CriticLLMClient } from "./critic.js";
import { computeDiversify, type DiversifyMode } from "./diversify.js";
import { CircuitBreaker, type CircuitBreakerConfig } from "./circuit.js";
import { applyRetryStrategy, type RetryStrategyMode } from "./retry-strategy.js";
import type { LastFailure } from "../opencode/prompts.js";

// --- Types ------------------------------------------------------------------

/**
 * Configuration for the retry engine, derived from plan defaults.
 */
export interface EngineConfig {
  /** Whether the critic (reflexion) is enabled. Default: false. */
  reflexion: boolean;
  /** Diversification mode. Default: "none". */
  diversify: DiversifyMode;
  /** Retry strategy mode. Default: "reset". */
  retryStrategy: RetryStrategyMode;
  /** Circuit breaker configuration. */
  circuitBreaker?: CircuitBreakerConfig;
  /** LLM client for the classifier fallback. Optional. */
  classifyLLM?: ClassifyLLMClient;
  /** LLM client for the critic. Required when reflexion is true. */
  criticLLM?: CriticLLMClient;
}

/**
 * Input to the engine for a single failed attempt.
 */
export interface EngineAttemptInput {
  /** SQLite database for event emission. */
  db: Database;
  /** Run ID for event scoping. */
  runId: string;
  /** Task ID for event scoping. */
  taskId: string;
  /** The working directory. */
  cwd: string;
  /** The failure from the verify step. */
  failure: LastFailure;
  /** Current attempt number (1-based). */
  attempt: number;
  /** Maximum number of attempts. */
  maxAttempts: number;
  /** The task prompt (for critic context). */
  taskPrompt: string;
  /** The task's declared touches globs. */
  touches: readonly string[];
  /** Engine configuration. */
  config: EngineConfig;
  /** The circuit breaker instance (shared across attempts). */
  circuitBreaker: CircuitBreaker;
}

/**
 * Result of the engine's per-attempt processing.
 */
export type EngineAttemptResult =
  | {
      /** Continue with the next attempt. */
      action: "retry";
      /** The enriched LastFailure to pass to fixPrompt. */
      enrichedFailure: LastFailure;
      /** Whether to use the alt_model for the next attempt. */
      useAltModel: boolean;
      /** Whether to create a fresh subagent session (placeholder). */
      freshSubagent: boolean;
    }
  | {
      /** Halt the retry loop — circuit breaker tripped. */
      action: "halt";
      /** The reason for halting. */
      reason: string;
    };

// --- Engine function --------------------------------------------------------

/**
 * Process a failed attempt through the retry intelligence pipeline.
 *
 * Pipeline:
 *   1. Classify the failure (heuristic + optional LLM fallback).
 *   2. Check circuit breakers (cost, wall-time, signature-recurrence).
 *   3. Compute diversification action for the next attempt.
 *   4. Run the critic if the diversification action requires it.
 *   5. Apply the retry strategy (reset/keep the working tree).
 *   6. Return the enriched failure for the next fixPrompt.
 *
 * @param input  The attempt input including failure context and config.
 * @returns      Whether to retry (with enriched prompt) or halt.
 */
export async function processAttempt(input: EngineAttemptInput): Promise<EngineAttemptResult> {
  const {
    db,
    runId,
    taskId,
    cwd,
    failure,
    attempt,
    maxAttempts,
    taskPrompt,
    touches,
    config,
    circuitBreaker,
  } = input;

  // 1. Classify the failure.
  const classifyInput = {
    command: failure.command,
    exitCode: failure.exitCode,
    output: failure.output,
  };
  const classification = await classifyFailure(classifyInput, config.classifyLLM);

  appendEvent(db, {
    runId,
    taskId,
    kind: "task.classify.result",
    payload: {
      attempt,
      failureClass: classification.failureClass,
      method: classification.method,
      matchedRule: classification.matchedRule,
    },
  });

  // 2. Check circuit breakers.
  const circuitResult = circuitBreaker.check({
    command: failure.command,
    exitCode: failure.exitCode,
    output: failure.output,
  });

  if (circuitResult.tripped) {
    const reason =
      `circuit breaker tripped: ${circuitResult.breaker} ` +
      `(threshold=${circuitResult.threshold}, actual=${circuitResult.actual})`;
    return { action: "halt", reason };
  }

  // 3. Compute diversification action.
  const diversifyResult = computeDiversify({
    attempt,
    maxAttempts,
    failureClass: classification.failureClass,
    mode: config.diversify,
  });

  appendEvent(db, {
    runId,
    taskId,
    kind: "task.diversify.applied",
    payload: {
      attempt,
      action: diversifyResult.action,
      failureClass: classification.failureClass,
      mode: config.diversify,
    },
  });

  // Handle fresh-subagent placeholder.
  if (diversifyResult.freshSubagent) {
    console.warn(
      `[pilot] engine: fresh-subagent diversification not yet implemented ` +
        `(run=${runId}, task=${taskId}, attempt=${attempt}). ` +
        `Falling back to narrow-scope.`,
    );
  }

  // 4. Run the critic if the diversification action requires it.
  let enrichedFailure: LastFailure = failure;

  if (diversifyResult.runCritic && config.reflexion && config.criticLLM) {
    const criticResult = await runCritic({
      db,
      runId,
      taskId,
      failure: classifyInput,
      failureClass: classification.failureClass,
      taskPrompt,
      touches,
      reflexion: config.reflexion,
      llm: config.criticLLM,
    });

    if (criticResult.ok) {
      enrichedFailure = {
        ...failure,
        criticReport: criticResult.report,
      };
    }
    // If critic failed, proceed with raw failure (graceful degradation).
  }

  // 5. Apply the retry strategy (reset/keep the working tree).
  const strategyResult = await applyRetryStrategy({
    cwd,
    mode: config.retryStrategy,
    runId,
    taskId,
  });

  if (!strategyResult.ok) {
    // Tree cleanup failed — this is a hard error; the worker should halt.
    return {
      action: "halt",
      reason: `retry strategy (${config.retryStrategy}) failed: ${strategyResult.error}`,
    };
  }

  // 6. Return the enriched failure for the next fixPrompt.
  return {
    action: "retry",
    enrichedFailure,
    useAltModel: diversifyResult.useAltModel,
    freshSubagent: diversifyResult.freshSubagent,
  };
}

/**
 * Create a new CircuitBreaker instance for a run.
 * Convenience factory so callers don't need to import circuit.ts directly.
 */
export function createCircuitBreaker(opts: {
  db: Database;
  runId: string;
  taskId: string;
  config?: CircuitBreakerConfig;
  startedAtMs?: number;
}): CircuitBreaker {
  return new CircuitBreaker(opts);
}
