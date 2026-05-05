/**
 * critic.ts — Haiku-based critic for the pilot retry engine.
 *
 * The critic takes a failure context and produces a structured `CriticReport`
 * with targeted fix guidance. The report is:
 *   1. Emitted as a `task.critic.report` event for observability.
 *   2. Fed into the enriched `fixPrompt` so the builder agent receives
 *      targeted guidance instead of raw failure output.
 *
 * The critic is optional — if `reflexion` is disabled in the plan defaults,
 * or if the LLM call fails/times out, the caller proceeds with the raw
 * failure output unchanged.
 *
 * The LLM client is injected as a dependency so tests can mock it without
 * real API calls.
 */

import type { Database } from "bun:sqlite";
import { appendEvent } from "../state/events.js";
import type { ClassifyInput } from "./classify.js";

// --- Types ------------------------------------------------------------------

/**
 * Structured report from the critic.
 *
 *   smallestFix  — the minimal code change that would fix the failure
 *   narrowScope  — which files/functions to focus on
 *   riskFlags    — potential side-effects or risks to watch for
 */
export interface CriticReport {
  smallestFix: string;
  narrowScope: string;
  riskFlags: string[];
}

/**
 * Input to the critic.
 */
export interface CriticInput {
  /** The failure to analyze. */
  failure: ClassifyInput;
  /** The failure class assigned by the classifier. */
  failureClass: string;
  /** The task prompt (for context). */
  taskPrompt: string;
  /** The task's declared touches globs (for scope context). */
  touches: readonly string[];
}

/**
 * LLM client interface for the critic. Injected as a dependency.
 */
export interface CriticLLMClient {
  /**
   * Ask the LLM to produce a CriticReport. Returns null if the call
   * fails, times out, or produces unparseable output.
   */
  critique(input: CriticInput): Promise<CriticReport | null>;
}

/**
 * Options for `runCritic`.
 */
export interface RunCriticOptions {
  /** SQLite database for event emission. */
  db: Database;
  /** Run ID for event scoping. */
  runId: string;
  /** Task ID for event scoping. */
  taskId: string;
  /** The failure to analyze. */
  failure: ClassifyInput;
  /** The failure class assigned by the classifier. */
  failureClass: string;
  /** The task prompt (for context). */
  taskPrompt: string;
  /** The task's declared touches globs. */
  touches: readonly string[];
  /** Whether reflexion (critic) is enabled. */
  reflexion: boolean;
  /** LLM client for the critic call. */
  llm: CriticLLMClient;
}

/**
 * Result of `runCritic`.
 */
export type RunCriticResult =
  | { ok: true; report: CriticReport }
  | { ok: false; reason: "disabled" | "llm-failed" | "llm-timeout" };

// --- Critic function --------------------------------------------------------

/**
 * Run the critic against a failure context.
 *
 * If `reflexion` is false, returns immediately with `reason: "disabled"`.
 * If the LLM call fails or returns null, returns `reason: "llm-failed"`.
 * On success, emits a `task.critic.report` event and returns the report.
 *
 * @param opts  Options including the LLM client, failure context, and DB.
 */
export async function runCritic(opts: RunCriticOptions): Promise<RunCriticResult> {
  if (!opts.reflexion) {
    return { ok: false, reason: "disabled" };
  }

  const input: CriticInput = {
    failure: opts.failure,
    failureClass: opts.failureClass,
    taskPrompt: opts.taskPrompt,
    touches: opts.touches,
  };

  let report: CriticReport | null = null;
  try {
    report = await opts.llm.critique(input);
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.message.includes("timeout") || err.message.includes("timed out") || err.name === "TimeoutError");
    appendEvent(opts.db, {
      runId: opts.runId,
      taskId: opts.taskId,
      kind: "task.critic.failed",
      payload: {
        reason: isTimeout ? "llm-timeout" : "llm-failed",
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { ok: false, reason: isTimeout ? "llm-timeout" : "llm-failed" };
  }

  if (report === null) {
    appendEvent(opts.db, {
      runId: opts.runId,
      taskId: opts.taskId,
      kind: "task.critic.failed",
      payload: { reason: "llm-failed", error: "LLM returned null" },
    });
    return { ok: false, reason: "llm-failed" };
  }

  appendEvent(opts.db, {
    runId: opts.runId,
    taskId: opts.taskId,
    kind: "task.critic.report",
    payload: {
      smallestFix: report.smallestFix,
      narrowScope: report.narrowScope,
      riskFlags: report.riskFlags,
      failureClass: opts.failureClass,
    },
  });

  return { ok: true, report };
}
