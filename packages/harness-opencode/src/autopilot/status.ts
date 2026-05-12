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
  // --- Plan-progress fields (optional; absent for single-file plans or on parser error) ---
  /** Total number of phases in the plan (multi-file plans only). */
  phaseCount?: number;
  /** Number of phases completed so far. */
  phasesCompleted?: number;
  /** Total checkbox items in main.md (multi-file plans only). */
  mainCheckboxesTotal?: number;
  /** Checked checkbox items in main.md. */
  mainCheckboxesCompleted?: number;
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
 * Public for testing.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(3)}`;
}

/**
 * Compose the status line.
 * Public for testing.
 */
export function composeStatusMessage(state: StatusState, now: number): string {
  const elapsed = formatElapsed(now - state.startedAt);
  const cost = formatCost(state.cumulativeCostUsd);
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

  if (state.lastIterationErrored) {
    return `working (${iterNote}, ${elapsed} elapsed, ${cost} used${planNote}) — last iteration errored`;
  }
  return `working (${iterNote}, ${elapsed} elapsed, ${cost} used${planNote})`;
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
