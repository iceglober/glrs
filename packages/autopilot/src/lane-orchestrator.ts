/**
 * Parallel-lane orchestrator (item 3.3).
 *
 * Replaces the sequential per-phase loop in `loop-session.ts` with an
 * N-lane scheduler. Each lane runs one phase at a time. When a lane
 * finishes, it picks up the next phase in the queue that does NOT
 * conflict (per the conflict graph from item 3.1) with any currently-
 * running phase. Phases that conflict with all currently-running phases
 * wait in the queue.
 *
 * Pure scheduler — no I/O, no git, no worktree creation. The caller
 * provides a `runPhase` callback that takes a phase filename plus a
 * lane id and returns a `PhaseResult`. Worktree create/merge/cleanup
 * (item 3.2) lives at the call site, not here.
 *
 * Sequential fallback (item 3.7): when `laneCount === 1`, the
 * orchestrator processes phases strictly in the input order, one at a
 * time — semantically identical to the original `for (const phase of
 * uncheckedPhases)` loop.
 *
 * Cancellation: an injected `AbortSignal` aborts pending phases (no
 * new phases are dispatched) but does not interrupt phases already in
 * flight — that's the runPhase callback's responsibility.
 */

import type { ConflictGraph } from "./conflict-graph.js";

export interface PhaseResult {
  /** Phase filename (e.g., "wave_1.md"). */
  phaseFile: string;
  /** Lane id this phase ran on. */
  laneId: string;
  /** Whether the phase completed successfully (all items checked). */
  ok: boolean;
  /**
   * Iterations consumed by this phase. Aggregated by the caller into
   * a session total.
   */
  iterations: number;
  /** Cost in USD attributed to this phase. */
  costUsd: number;
  /** Optional structured payload returned by `runPhase`. */
  payload?: unknown;
  /**
   * When `ok === false`, this signals that the orchestrator should
   * stop scheduling new phases (the caller's contract is "first failure
   * stops the run", matching the sequential loop's behavior).
   */
  fatal?: boolean;
}

export interface RunLanesOptions {
  /** Phases to run, in queue order. */
  phases: string[];
  /** Conflict graph from item 3.1. */
  conflictGraph: ConflictGraph;
  /**
   * Number of parallel lanes. `1` falls back to sequential semantics
   * (no overlap, phases dispatched in `phases` order).
   */
  laneCount: number;
  /**
   * Run a single phase. Receives the phase filename plus the lane id
   * the caller should use for logging / worktree naming. Must return a
   * `PhaseResult`. Errors thrown here propagate up to `runLanes`'s
   * caller — the orchestrator does not catch them.
   */
  runPhase: (phaseFile: string, laneId: string) => Promise<PhaseResult>;
  /**
   * Optional cancellation. When aborted, no new phases are dispatched.
   * In-flight phases continue until their own runPhase returns.
   */
  abortSignal?: AbortSignal;
  /**
   * Optional structured logger for scheduling decisions. Tests pass a
   * recording function; production passes a pino childLogger.
   */
  logger?: {
    info?: (objOrMsg: unknown, msg?: string) => void;
    debug?: (objOrMsg: unknown, msg?: string) => void;
  };
}

export interface RunLanesResult {
  /** Per-phase results, in completion order. */
  results: PhaseResult[];
  /** Phases that were skipped because the run aborted. */
  skipped: string[];
}

/**
 * Returns true if `phase` conflicts with any phase in `running`.
 * Self-conflict is not counted (a phase doesn't conflict with itself).
 */
function conflictsWithRunning(
  phase: string,
  running: Set<string>,
  graph: ConflictGraph,
): boolean {
  const conflicts = graph.conflicts.get(phase);
  if (!conflicts) return false;
  for (const r of running) {
    if (r === phase) continue;
    if (conflicts.has(r)) return true;
  }
  return false;
}

/**
 * Run phases through N lanes with conflict-aware scheduling.
 *
 * Algorithm:
 *   - Maintain a queue of pending phases (input order).
 *   - Maintain a set of currently-running phases.
 *   - Each scheduling step: fill idle lanes by picking the first queue
 *     entry that doesn't conflict with anything running.
 *   - Wait for any lane to finish (Promise.race), record its result,
 *     re-evaluate the queue, repeat.
 *   - Stop scheduling new phases when (a) the abort signal fires, OR
 *     (b) any phase returns `fatal: true`.
 *
 * Sequential fallback (`laneCount === 1`): the queue is drained in
 * order, one phase at a time — `Promise.race` over a single promise
 * is just `await` semantics.
 */
export async function runLanes(opts: RunLanesOptions): Promise<RunLanesResult> {
  const laneCount = Math.max(1, opts.laneCount);
  const queue = [...opts.phases];
  const running = new Set<string>();
  const results: PhaseResult[] = [];
  const skipped: string[] = [];
  let stopScheduling = false;

  // Each in-flight task is a promise that resolves to its PhaseResult.
  // We tag the promise with its phase + laneId so we can dedupe in the
  // running set when it resolves.
  interface InFlight {
    phase: string;
    laneId: string;
    promise: Promise<PhaseResult>;
  }
  const inFlight: InFlight[] = [];

  // Lane IDs are 1-indexed string slugs ("lane-1", "lane-2", ...). When
  // a lane finishes, its id is freed and reused by the next dispatch.
  // We use a free-list rather than a counter so log output is stable
  // across runs.
  const freeLanes: string[] = [];
  for (let i = 1; i <= laneCount; i++) {
    freeLanes.push(`lane-${i}`);
  }

  /**
   * Pull the next phase off the queue that doesn't conflict with the
   * currently-running set. Returns null if no eligible phase exists.
   * Mutates `queue` (removes the picked phase).
   */
  const pickNext = (): string | null => {
    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      if (!conflictsWithRunning(candidate, running, opts.conflictGraph)) {
        queue.splice(i, 1);
        return candidate;
      }
    }
    return null;
  };

  /**
   * Fill idle lanes by dispatching eligible phases. Returns the count
   * of newly-dispatched phases.
   */
  const fillLanes = (): number => {
    let dispatched = 0;
    while (
      !stopScheduling &&
      freeLanes.length > 0 &&
      queue.length > 0
    ) {
      const phase = pickNext();
      if (!phase) break; // nothing eligible — wait for a lane to free
      const laneId = freeLanes.shift()!;
      running.add(phase);
      opts.logger?.info?.(
        { laneId, phase, lanesActive: running.size, queued: queue.length },
        `dispatch phase ${phase} on ${laneId}`,
      );
      const promise = opts.runPhase(phase, laneId);
      inFlight.push({ phase, laneId, promise });
      dispatched++;
    }
    return dispatched;
  };

  // Honor an abort that fires before we even dispatch.
  if (opts.abortSignal?.aborted) {
    return { results: [], skipped: [...queue] };
  }
  const abortListener = () => {
    stopScheduling = true;
    opts.logger?.info?.({ remaining: queue.length }, "abort received — draining in-flight lanes");
  };
  opts.abortSignal?.addEventListener("abort", abortListener, { once: true });

  try {
    fillLanes();

    while (inFlight.length > 0) {
      // Race the in-flight promises. Tag each with its index so we can
      // remove the right one when it settles.
      const indexed = inFlight.map((f, idx) =>
        f.promise.then((r) => ({ idx, result: r })),
      );
      const winner = await Promise.race(indexed);
      const { idx, result } = winner;
      const finished = inFlight[idx];
      inFlight.splice(idx, 1);
      running.delete(finished.phase);
      freeLanes.push(finished.laneId);
      results.push(result);

      opts.logger?.info?.(
        {
          laneId: finished.laneId,
          phase: finished.phase,
          ok: result.ok,
          iterations: result.iterations,
          remaining: queue.length,
        },
        `completed phase ${finished.phase} on ${finished.laneId} (${result.ok ? "ok" : "failed"})`,
      );

      if (result.fatal) {
        stopScheduling = true;
        opts.logger?.info?.(
          { phase: finished.phase },
          `fatal failure — stopping new dispatches`,
        );
      }

      if (!stopScheduling) {
        fillLanes();
      }
    }

    // Anything left in the queue was skipped (abort or fatal).
    skipped.push(...queue);
  } finally {
    opts.abortSignal?.removeEventListener("abort", abortListener);
  }

  return { results, skipped };
}
