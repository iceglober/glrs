/**
 * circuit.ts — circuit breakers for the pilot retry engine.
 *
 * Three circuit breakers halt retry loops when:
 *   1. Cumulative cost exceeds the configured cap (max_total_cost_usd)
 *   2. Wall-time exceeds the run limit (max_run_wall_ms)
 *   3. The same failure signature recurs 3+ times (signature-recurrence)
 *
 * Each trip emits a `task.circuit.tripped` event with the breaker type
 * and threshold.
 *
 * Circuit breakers are cumulative across attempts within a run (not
 * per-task for cost/wall-time).
 *
 * Signature hashing: hash of (command + exitCode + first 512 bytes of
 * output after stripping ANSI codes and timestamps).
 */

import type { Database } from "bun:sqlite";
import { appendEvent } from "../state/events.js";

// --- Types ------------------------------------------------------------------

/**
 * The three circuit breaker types.
 */
export type CircuitBreakerType =
  | "cost"
  | "wall-time"
  | "signature-recurrence";

/**
 * Configuration for the circuit breakers.
 */
export interface CircuitBreakerConfig {
  /** Maximum cumulative cost in USD. Undefined = no limit. */
  maxTotalCostUsd?: number;
  /** Maximum wall-time in milliseconds. Undefined = no limit. */
  maxRunWallMs?: number;
  /**
   * Number of identical failure signatures before tripping.
   * Default: 3.
   */
  signatureRecurrenceLimit?: number;
}

/**
 * State tracked by the circuit breaker across attempts.
 */
export interface CircuitBreakerState {
  /** Cumulative cost in USD across all attempts. */
  cumulativeCostUsd: number;
  /** Wall-time start timestamp (ms since epoch). */
  startedAtMs: number;
  /** Map from failure signature hash to occurrence count. */
  signatureCounts: Map<string, number>;
}

/**
 * Input for a circuit breaker check.
 */
export interface CircuitCheckInput {
  /** The failure command. */
  command: string;
  /** The failure exit code. */
  exitCode: number;
  /** The failure output (will be truncated and normalized). */
  output: string;
  /** Cost of the current attempt in USD. */
  attemptCostUsd?: number;
  /** Current wall-time in ms (defaults to Date.now()). */
  nowMs?: number;
}

/**
 * Result of a circuit breaker check.
 */
export type CircuitCheckResult =
  | { tripped: false }
  | {
      tripped: true;
      breaker: CircuitBreakerType;
      threshold: number;
      actual: number;
    };

// --- Circuit breaker --------------------------------------------------------

/**
 * Stateful circuit breaker. Create one per run and pass it to each
 * attempt check.
 */
export class CircuitBreaker {
  private readonly config: Required<CircuitBreakerConfig>;
  private readonly state: CircuitBreakerState;
  private readonly db: Database;
  private readonly runId: string;
  private readonly taskId: string;

  constructor(opts: {
    db: Database;
    runId: string;
    taskId: string;
    config?: CircuitBreakerConfig;
    startedAtMs?: number;
  }) {
    this.db = opts.db;
    this.runId = opts.runId;
    this.taskId = opts.taskId;
    this.config = {
      maxTotalCostUsd: opts.config?.maxTotalCostUsd ?? Infinity,
      maxRunWallMs: opts.config?.maxRunWallMs ?? Infinity,
      signatureRecurrenceLimit: opts.config?.signatureRecurrenceLimit ?? 3,
    };
    this.state = {
      cumulativeCostUsd: 0,
      startedAtMs: opts.startedAtMs ?? Date.now(),
      signatureCounts: new Map(),
    };
  }

  /**
   * Check whether any circuit breaker should trip after a failure.
   *
   * Side effects:
   *   - Updates cumulative cost and signature counts.
   *   - Emits a `task.circuit.tripped` event if a breaker trips.
   *
   * @param input  The failure context for this attempt.
   * @returns      Whether a breaker tripped and which one.
   */
  check(input: CircuitCheckInput): CircuitCheckResult {
    const nowMs = input.nowMs ?? Date.now();

    // Update cumulative cost.
    if (input.attemptCostUsd !== undefined) {
      this.state.cumulativeCostUsd += input.attemptCostUsd;
    }

    // 1. Cost check.
    if (
      this.config.maxTotalCostUsd !== Infinity &&
      this.state.cumulativeCostUsd > this.config.maxTotalCostUsd
    ) {
      this.emitTripped("cost", this.config.maxTotalCostUsd, this.state.cumulativeCostUsd);
      return {
        tripped: true,
        breaker: "cost",
        threshold: this.config.maxTotalCostUsd,
        actual: this.state.cumulativeCostUsd,
      };
    }

    // 2. Wall-time check.
    const elapsedMs = nowMs - this.state.startedAtMs;
    if (
      this.config.maxRunWallMs !== Infinity &&
      elapsedMs > this.config.maxRunWallMs
    ) {
      this.emitTripped("wall-time", this.config.maxRunWallMs, elapsedMs);
      return {
        tripped: true,
        breaker: "wall-time",
        threshold: this.config.maxRunWallMs,
        actual: elapsedMs,
      };
    }

    // 3. Signature recurrence check.
    const sig = computeSignature(input.command, input.exitCode, input.output);
    const count = (this.state.signatureCounts.get(sig) ?? 0) + 1;
    this.state.signatureCounts.set(sig, count);

    if (count >= this.config.signatureRecurrenceLimit) {
      this.emitTripped("signature-recurrence", this.config.signatureRecurrenceLimit, count);
      return {
        tripped: true,
        breaker: "signature-recurrence",
        threshold: this.config.signatureRecurrenceLimit,
        actual: count,
      };
    }

    return { tripped: false };
  }

  /**
   * Get the current cumulative cost.
   */
  getCumulativeCostUsd(): number {
    return this.state.cumulativeCostUsd;
  }

  /**
   * Get the current signature counts (for testing/observability).
   */
  getSignatureCounts(): ReadonlyMap<string, number> {
    return this.state.signatureCounts;
  }

  private emitTripped(
    breaker: CircuitBreakerType,
    threshold: number,
    actual: number,
  ): void {
    appendEvent(this.db, {
      runId: this.runId,
      taskId: this.taskId,
      kind: "task.circuit.tripped",
      payload: { breaker, threshold, actual },
    });
  }
}

// --- Signature hashing ------------------------------------------------------

/**
 * Compute a failure signature for recurrence detection.
 *
 * Hash of: command + exitCode + first 512 bytes of output after
 * stripping ANSI codes and timestamps.
 *
 * Uses a simple djb2-style hash — deterministic, fast, no crypto needed.
 */
export function computeSignature(
  command: string,
  exitCode: number,
  output: string,
): string {
  const normalized = stripAnsiAndTimestamps(output).slice(0, 512);
  const raw = `${command}\x00${exitCode}\x00${normalized}`;
  return djb2Hash(raw);
}

/**
 * Strip ANSI escape codes and common timestamp patterns from output.
 */
function stripAnsiAndTimestamps(s: string): string {
  // Strip ANSI escape codes.
  // eslint-disable-next-line no-control-regex
  let result = s.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");
  // Strip ISO timestamps (2024-01-15T14:30:25.123Z or similar).
  result = result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<ts>");
  // Strip Unix timestamps (10-13 digit numbers that look like epoch ms).
  result = result.replace(/\b\d{10,13}\b/g, "<epoch>");
  // Strip PIDs (common in process output like "[12345]").
  result = result.replace(/\[(\d{3,6})\]/g, "[<pid>]");
  return result;
}

/**
 * djb2 hash — fast, deterministic, good enough for signature comparison.
 * Returns a hex string.
 */
function djb2Hash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
