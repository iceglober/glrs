/**
 * Throttle logic for status updates.
 *
 * Pure function: given the current state and a timestamp, returns whether
 * the update can proceed and how long to wait if not.
 *
 * State (the `lastEmittedAt` map) lives on the MCP server process's heap.
 * This module only provides the decision logic; the caller owns the state.
 */

export type ThrottleKey = { runId: string; taskId: string };

export type ThrottleResult =
  | { ok: true }
  | { ok: false; retryInMs: number };

export type ThrottleState = Map<string, number>;

/**
 * Check if a status update can be emitted for the given (runId, taskId).
 *
 * @param key - The runId + taskId tuple that uniquely identifies the task
 * @param now - Current timestamp in milliseconds
 * @param lastEmittedAt - Map from "runId|taskId" to last emission timestamp
 * @param minIntervalMs - Minimum interval between emissions (default 60s)
 * @returns ThrottleResult indicating ok or retryInMs
 */
export function canEmit(
  key: ThrottleKey,
  now: number,
  lastEmittedAt: ThrottleState,
  minIntervalMs: number = 60_000,
): ThrottleResult {
  const mapKey = `${key.runId}|${key.taskId}`;
  const last = lastEmittedAt.get(mapKey);

  if (last === undefined) {
    return { ok: true };
  }

  const elapsed = now - last;
  if (elapsed >= minIntervalMs) {
    return { ok: true };
  }

  return { ok: false, retryInMs: minIntervalMs - elapsed };
}

/**
 * Record that an emission occurred for the given key at the given time.
 *
 * @param key - The runId + taskId tuple
 * @param now - Current timestamp in milliseconds
 * @param lastEmittedAt - Map to update
 */
export function recordEmission(
  key: ThrottleKey,
  now: number,
  lastEmittedAt: ThrottleState,
): void {
  const mapKey = `${key.runId}|${key.taskId}`;
  lastEmittedAt.set(mapKey, now);
}
