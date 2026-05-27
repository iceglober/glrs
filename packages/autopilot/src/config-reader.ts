/**
 * CLI flag override application for autopilot configuration.
 *
 * Maps CLI flags to their config field equivalents and applies them with
 * proper precedence. All fields are optional; undefined flags are ignored.
 * Returns a new config object without mutating the input.
 */

export interface CLIFlags {
  /** Adapter name override (--adapter / -a) */
  adapter?: string;
  /** Resume from checkpoint (--resume) */
  resume?: boolean;
  /** Per-phase iteration budget override (--max-iterations-per-phase) */
  maxIterationsPerPhase?: number;
  /** Number of parallel lanes (--parallel) */
  parallel?: number;
  /** Auto-ship after completion (--ship) */
  ship?: boolean;
  /** Per-iteration stall timeout in ms (--stall-timeout) */
  stallTimeout?: number;
  /** Webhook URL for notifications (--notify) */
  notify?: string;
}

/**
 * Deep clone utility for config objects to ensure immutability.
 */
function deepClone(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item));
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  const cloned: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
  }

  return cloned;
}

/**
 * Applies CLI flag overrides to autopilot configuration.
 *
 * Maps each CLI flag to its config field equivalent:
 * - `--adapter` → `adapter` (highest precedence)
 * - `--parallel N` → `execution_order: "parallel"` + `parallel_lanes: N`
 * - `--ship` → `auto_ship: true`
 * - `--max-iterations-per-phase N` → `max_iterations_per_phase: N`
 * - `--stall-timeout N` → `stall_timeout: N`
 * - `--notify URL` → `notify_url: URL`
 *
 * Undefined flags are skipped (no override applied).
 *
 * @param config The resolved autopilot configuration
 * @param flags CLI flags to apply
 * @returns A new config object with overrides applied (input is not mutated)
 */
export function applyCLIOverrides(config: unknown, flags: CLIFlags): unknown {
  // Deep clone to ensure immutability
  const result = deepClone(config) as Record<string, unknown>;

  // Ensure models and adapters blocks exist
  if (!result.models || typeof result.models !== "object") {
    result.models = {};
  }
  const models = result.models as Record<string, unknown>;

  // --adapter: highest precedence
  if (flags.adapter !== undefined) {
    result.adapter = flags.adapter;
  }

  // --parallel N: set both execution_order and parallel_lanes
  if (flags.parallel !== undefined) {
    result.execution_order = "parallel";
    result.parallel_lanes = flags.parallel;
  }

  // --ship: auto-ship after completion
  if (flags.ship) {
    result.auto_ship = true;
  }

  // --max-iterations-per-phase N
  if (flags.maxIterationsPerPhase !== undefined) {
    result.max_iterations_per_phase = flags.maxIterationsPerPhase;
  }

  // --stall-timeout N
  if (flags.stallTimeout !== undefined) {
    result.stall_timeout = flags.stallTimeout;
  }

  // --notify URL
  if (flags.notify !== undefined) {
    result.notify_url = flags.notify;
  }

  return result;
}
