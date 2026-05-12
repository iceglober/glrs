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
 * Per-iteration stall timeout. If a single iteration produces no idle
 * signal within this window, something is broken (60 minutes).
 */
export const STALL_MS = 60 * 60 * 1000;

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
