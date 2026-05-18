/**
 * Status-heartbeat helper for the autopilot loop.
 *
 * Fires a periodic "still working" summary log at info level every N
 * milliseconds (see STATUS_INTERVAL_MS in config.ts). The summary
 * reports:
 *
 *   - elapsed wall time since loop start
 *   - iteration count (completed iterations, not current)
 *   - cumulative session cost in USD (sampled via session.get().data.cost)
 *   - a 1-line "working successfully" signal (or a warning if the last
 *     iteration hit an error)
 *
 * Decoupled from the Ralph loop's iteration accounting — the heartbeat
 * reads a shared state snapshot that the loop updates between iterations.
 * Fires on a setInterval timer, not per-iteration, so the user sees
 * activity even during long single-iteration sessions (PRIME streaming
 * text / running a slow test suite / waiting on an LLM response).
 */

import type { Logger } from "pino";
import * as fs from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface StatusState {
  /** Wall-clock timestamp when the loop started. */
  startedAt: number;
  /** Completed iteration count (not the current in-flight iteration). */
  iterationsCompleted: number;
  /** Latest cumulative session cost in USD, sampled at iteration boundaries. */
  cumulativeCostUsd: number;
  /** Whether the most recent iteration made filesystem progress. */
  lastIterationProgress: boolean;
  /** Whether the most recent iteration errored. */
  lastIterationErrored: boolean;
  /**
   * When true, `cumulativeCostUsd` is an estimate from token counts
   * (not API-reported). Displayed as "~$X.XXX est".
   */
  costIsEstimated?: boolean;
  // --- Plan-progress fields (optional; absent for single-file plans or on parser error) ---
  /** Total number of phases in the plan (multi-file plans only). */
  phaseCount?: number;
  /** Number of phases completed so far. */
  phasesCompleted?: number;
  /** Total checkbox items in main.md (multi-file plans only). */
  mainCheckboxesTotal?: number;
  /** Checked checkbox items in main.md. */
  mainCheckboxesCompleted?: number;
  /**
   * Active parallel lanes (item 3.4). Only set when the orchestrator is
   * running > 1 lane; the sequential path leaves this undefined and
   * `composeStatusMessage` falls back to the single-stream output.
   */
  lanes?: Record<string, LaneState>;
}

export interface LaneState {
  /** Phase filename currently running on this lane. */
  phaseFile: string;
  /** Iteration number within the lane's current phase (1-based). */
  iteration: number;
  /** Most-recent tool name observed on the lane (optional). */
  lastTool?: string;
}

export interface StatusHeartbeat {
  /** Start the heartbeat timer. Idempotent — safe to call multiple times. */
  start(): void;
  /** Stop the timer. Safe to call if not started. */
  stop(): void;
  /** Update the shared state. Call between iterations. */
  update(patch: Partial<StatusState>): void;
  /** Read the current state snapshot (for testing). */
  getState(): StatusState;
}

export interface StatusHeartbeatOptions {
  logger: Logger;
  intervalMs: number;
  /** Optional async function to poll current session cost. Called on
   *  each heartbeat tick. If provided, the returned cost replaces
   *  the heartbeat's cumulativeCostUsd on each tick. */
  pollCost?: () => Promise<number>;
  /**
   * Optional path to write the status snapshot as JSON on each tick.
   * Written atomically via tmp-file-then-rename. Non-fatal on error.
   * Default: undefined (no file write).
   */
  statusFilePath?: string;
  /** Test-only: inject clock and timer functions. */
  _deps?: {
    now?: () => number;
    setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
    clearInterval?: (id: ReturnType<typeof setInterval>) => void;
  };
}

/**
 * Format elapsed milliseconds as "Xh Ym Zs" (Xh is omitted when 0).
 * Public for testing.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format cost as USD with 3 decimal places, or "$0.00" for zero.
 * When `estimated` is true, prepends "~" and appends " est" to indicate
 * the cost is an estimate (e.g., from token counts when API cost is unavailable).
 * Public for testing.
 */
export function formatCost(usd: number, estimated?: boolean): string {
  if (usd === 0) return "pending";
  const base = `$${usd.toFixed(3)}`;
  return estimated ? `~${base} est` : base;
}

/**
 * Compose the status line.
 * Public for testing.
 */
export function composeStatusMessage(state: StatusState, now: number): string {
  const elapsed = formatElapsed(now - state.startedAt);
  const cost = formatCost(state.cumulativeCostUsd, state.costIsEstimated);
  const iterNote =
    state.iterationsCompleted === 0
      ? "iteration 1 in flight"
      : `${state.iterationsCompleted} iteration${state.iterationsCompleted === 1 ? "" : "s"} complete`;

  // Plan-progress segment — only included when multi-file plan fields are present.
  let planNote = "";
  if (
    state.phaseCount !== undefined &&
    state.phasesCompleted !== undefined &&
    state.mainCheckboxesTotal !== undefined &&
    state.mainCheckboxesCompleted !== undefined
  ) {
    planNote = `, phase ${state.phasesCompleted}/${state.phaseCount}, ${state.mainCheckboxesCompleted}/${state.mainCheckboxesTotal} boxes`;
  }

  // Lane segment — only included when parallel lanes are active (item 3.4).
  // Format: `, lanes: [lane-1: phase_2 iter 3, lane-2: phase_4 iter 1]`.
  let laneNote = "";
  if (state.lanes && Object.keys(state.lanes).length > 0) {
    const laneIds = Object.keys(state.lanes).sort();
    const parts = laneIds.map((id) => {
      const l = state.lanes![id];
      const tool = l.lastTool ? ` ${l.lastTool}` : "";
      return `${id}: ${l.phaseFile} iter ${l.iteration}${tool}`;
    });
    laneNote = `, lanes: [${parts.join(", ")}]`;
  }

  if (state.lastIterationErrored) {
    return `working (${iterNote}, ${elapsed} elapsed, ${cost} used${planNote}${laneNote}) — last iteration errored`;
  }
  return `working (${iterNote}, ${elapsed} elapsed, ${cost} used${planNote}${laneNote})`;
}

/**
 * Atomically write the status snapshot to disk.
 * Uses tmp-file-then-rename for safe concurrent reads.
 */
async function writeStatusFile(filePath: string, state: StatusState, nowMs: number): Promise<void> {
  const snapshot = {
    ...state,
    elapsedMs: nowMs - state.startedAt,
    writtenAt: new Date(nowMs).toISOString(),
  };
  const json = JSON.stringify(snapshot, null, 2) + "\n";
  const tmp = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;

  // Ensure parent directory exists
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }

  await fs.writeFile(tmp, json, "utf8");
  await fs.rename(tmp, filePath);
}

export function createStatusHeartbeat(opts: StatusHeartbeatOptions): StatusHeartbeat {
  const now = opts._deps?.now ?? (() => Date.now());
  const setIntervalFn = opts._deps?.setInterval ?? setInterval;
  const clearIntervalFn = opts._deps?.clearInterval ?? clearInterval;

  const state: StatusState = {
    startedAt: now(),
    iterationsCompleted: 0,
    cumulativeCostUsd: 0,
    lastIterationProgress: false,
    lastIterationErrored: false,
  };

  let timerId: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    // Poll cost if a poller is provided — fire-and-forget async
    if (opts.pollCost) {
      opts.pollCost().then((cost) => {
        if (cost > 0) state.cumulativeCostUsd = cost;
      }).catch(() => {
        // Cost poll failure is non-fatal
      });
    }
    const message = composeStatusMessage(state, now());
    opts.logger.info(
      {
        elapsedMs: now() - state.startedAt,
        iterationsCompleted: state.iterationsCompleted,
        cumulativeCostUsd: state.cumulativeCostUsd,
        lastIterationProgress: state.lastIterationProgress,
        lastIterationErrored: state.lastIterationErrored,
      },
      message,
    );

    // Write status file atomically if configured
    if (opts.statusFilePath) {
      writeStatusFile(opts.statusFilePath, state, now()).catch(() => {
        // Non-fatal — status file write failure must not affect the loop
      });
    }
  };

  return {
    start(): void {
      if (timerId !== null) return;
      timerId = setIntervalFn(tick, opts.intervalMs);
      // In Node/Bun, a setInterval keeps the event loop alive. That's fine
      // here — the loop's primary driver (sendAndWait) is also keeping it
      // alive, so unref() isn't needed.
    },
    stop(): void {
      if (timerId === null) return;
      clearIntervalFn(timerId);
      timerId = null;
    },
    update(patch: Partial<StatusState>): void {
      Object.assign(state, patch);
    },
    getState(): StatusState {
      return { ...state };
    },
  };
}
