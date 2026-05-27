/**
 * Shared type definitions for the loop session orchestrator and plan session.
 * Defined here so both loop-session.ts, plan-session.ts (in autopilot) and
 * the CLI interactive command can import them without circular dependencies.
 */

import type { AutopilotLogger } from "./lib/logger.js";
import type { SessionEventEmitter } from "./session-runner.js";
import type { AgentAdapter } from "./adapter.js";

export interface PlanSessionOptions {
  scopePath: string;
  planDir: string;
  slug: string;
}

export interface PlanSessionResult {
  planPath: string;
}

export interface LoopSessionOptions {
  planPath: string;
  cwd: string;
  /**
   * When true, read `<cwd>/.agent/autopilot-checkpoint.json` and skip
   * phases already listed in `completedPhases` (provided the checkpoint's
   * `planPath` matches the current `--plan`). On full completion the
   * checkpoint is deleted.
   */
  resume?: boolean;
  /**
   * Per-phase iteration budget override. When unset, defaults to 25
   * (see MAX_ITERATIONS_PER_PHASE in config.ts).
   * A phase that hits `max-iterations` is treated as a soft failure:
   * checkpoint is written, a warning is logged, and the run continues
   * to the next phase rather than terminating.
   */
  maxIterationsPerPhase?: number;
  /**
   * Maximum number of recovery attempts per phase across all failure modes
   * (verify failures, agent crashes, stalls, max-iterations). Each retry
   * gets evolving context that changes strategy. Later attempts escalate
   * to the deep model. Default: 5.
   */
  maxPhaseRetries?: number;
  /**
   * Number of parallel lanes for phase execution (item 3.3).
   * Default: 1 (sequential — preserves the original semantics exactly).
   * When > 1 AND the conflict graph reveals at least one independent
   * pair, phases are dispatched to per-lane git worktrees and merged
   * back on completion (items 3.2 + 3.6). When ≤ 1 OR no parallelism
   * is possible (every phase conflicts with every other), the runner
   * falls back to the sequential path (item 3.7) — no worktree overhead.
   */
  parallel?: number;
  /**
   * Auto-ship after all phases pass (item 4.7). When true, the runner
   * pushes the current branch and opens a PR via `gh pr create` after
   * verify passes and a changeset has been generated. When false (the
   * default), the runner stops at "all phases complete, run `/ship` to
   * finalize." Push targets and the no-force/no-merge invariants are
   * enforced inside `auto-ship.ts`.
   */
  ship?: boolean;
  /**
   * Pre-created logger shared across the entire autopilot session
   * (enrichment + loop + debrief). When provided, the loop reuses
   * this logger instead of creating its own.
   */
  logger?: AutopilotLogger;
  /**
   * Optional event emitter for typed SessionEvents (Channel 1).
   * When provided, loop-session.ts emits phase:start, phase:done,
   * verify:*, and error events. The emitter is also forwarded to
   * runRalphLoop so iteration-level events flow through.
   */
  emitter?: SessionEventEmitter;
  /**
   * Agent adapter to use for driving the AI agent.
   * Required in production — the CLI injects the OpenCode adapter.
   */
  adapter?: AgentAdapter;
  /**
   * Resolved autopilot configuration from `.glrs/autopilot.yaml` (plan-specific > project > defaults).
   * Unused in this wave — wired for future consumers that need to read individual config fields.
   */
  config?: unknown;
  /**
   * Optional abort signal for graceful shutdown. When the signal fires,
   * the loop writes a checkpoint and returns with exitReason: "aborted"
   * at the next phase boundary. Mid-tool-call iterations are not
   * interrupted — the abort is checked between phases only.
   */
  signal?: AbortSignal;
}
