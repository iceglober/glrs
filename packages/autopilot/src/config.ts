/**
 * Default budgets and constants for the Ralph loop autopilot engine.
 */

/** Maximum number of loop iterations before giving up. */
export const MAX_ITERATIONS = 50;

/**
 * Number of consecutive zero-progress iterations before the loop
 * declares the agent is struggling and exits.
 */
export const STRUGGLE_THRESHOLD = 3;

/** Total wall-clock timeout for one `glrs oc autopilot` invocation (4 hours). */
export const TIMEOUT_MS = 4 * 60 * 60 * 1000;

/**
 * Per-iteration stall timeout, keyed by model tier. If a single
 * iteration produces no idle signal within the tier's window,
 * something is broken.
 *
 * Deep models (Opus, Sonnet thinking) get the longest window — they're
 * permitted to chew on a hard problem for a while. Mid-tier executors
 * are faster and a long stall there is much more likely to be a stuck
 * call than a productive think. Fast models are the most responsive
 * and warrant the shortest window.
 *
 * Fallback defaults when config.stall_timeout is not set.
 * The CLI accepts `--stall-timeout <ms>` to override the tier-default,
 * and config.stall_timeout overrides both the CLI default and tier lookup.
 */
export const STALL_MS_BY_TIER = {
  deep: 3 * 60 * 1000,
  mid: 2 * 60 * 1000,
  "mid-execute": 90 * 1000,
  "autopilot-execute": 90 * 1000,
  fast: 90 * 1000,
} as const;

/** Backwards-compatible default (used when no tier is resolved). */
export const STALL_MS = STALL_MS_BY_TIER.deep;

/** Default stall timeout: 90 seconds. Used for per-item execution.
 * Aggressive by design — hung API connections should fail fast and retry
 * rather than block for minutes. The adapter resets this timer on every
 * tool call, text delta, and cost update, so active responses never hit it. */
export const STALL_MS_DEFAULT = 90 * 1000;

/**
 * Phase-level iteration budgets, keyed by model tier (item 2.7).
 * Fallback defaults when config.max_iterations_per_phase is not set.
 */
export const MAX_ITERATIONS_PER_PHASE_BY_TIER = {
  deep: 5,
  mid: 8,
  "mid-execute": 10,
  "autopilot-execute": 10,
  fast: 10,
} as const;

/** Default per-phase iteration budget: 25. Used for per-item execution. */
export const MAX_ITERATIONS_PER_PHASE = 25;

/**
 * Per-item iteration budget (item 4.8).
 * Fallback default when config.max_iterations_per_item is not set.
 * Each item gets a fresh session with this much rope before moving to the next item.
 */
export const MAX_ITERATIONS_PER_ITEM = 5;

/**
 * Minimum per-item iteration budget. When the per-phase budget divided
 * across items yields fewer iterations than this, the floor wins.
 * Prevents large phases from starving individual items.
 */
export const MIN_PER_ITEM_ITERATIONS = 3;

/**
 * Kill-switch file path (relative to cwd). If this file exists at the
 * start of any iteration, the loop exits immediately.
 */
export const KILL_SWITCH_PATH = ".agent/autopilot-disable";

/**
 * Sentinel tag the agent emits to signal completion. The loop scans
 * the last assistant message for this exact string.
 */
export const SENTINEL_TAG = "<autopilot-done>";

/**
 * Status-heartbeat interval. Every N milliseconds the loop emits an
 * info-level "working" log line summarizing elapsed time, iteration
 * count, and cumulative cost. Default: 5 minutes.
 * Override via GLRS_AUTOPILOT_STATUS_INTERVAL_MS (parsed as integer,
 * clamped to [1000, 1h]).
 */
export const STATUS_INTERVAL_MS: number = (() => {
  const env = process.env["GLRS_AUTOPILOT_STATUS_INTERVAL_MS"];
  if (!env) return 5 * 60 * 1000;
  const n = Number.parseInt(env, 10);
  if (Number.isNaN(n) || n < 1000 || n > 60 * 60 * 1000) return 5 * 60 * 1000;
  return n;
})();
