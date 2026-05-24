/**
 * Session state derivation from event streams.
 *
 * `deriveState` is a pure function: given a sequence of SessionEvents,
 * it returns a `SessionHandle` describing the current state of the session.
 * It handles partial streams (process died mid-session) and all event types.
 */

import type { SessionEvent } from "./session-events.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "running"
  | "enriching"
  | "verifying"
  | "complete"
  | "error"
  | "stale";

export interface SessionHandle {
  /** Derived from planPath + startedAt — stable across polls. */
  id: string;
  planPath: string;
  cwd: string;
  /** resume flag from session:start */
  resume: boolean;
  status: SessionStatus;
  currentPhase?: { phase: string; current: number; total: number };
  currentIteration?: { iteration: number; max: number };
  totalIterations: number;
  cost: number;
  startedAt: string;
  lastEventAt: string;
  error?: string;
  exitReason?: string;
  enrichProgress?: { done: number; total: number };
  verifyProgress?: { passed: number; total: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a stable ID from planPath + startedAt timestamp. */
function deriveId(planPath: string, startedAt: string): string {
  // Simple deterministic hash: base64url of "planPath|timestamp"
  const raw = `${planPath}|${startedAt}`;
  // Use btoa-compatible encoding (available in Bun/Node)
  return Buffer.from(raw).toString("base64url").slice(0, 24);
}

// ---------------------------------------------------------------------------
// deriveState
// ---------------------------------------------------------------------------

/**
 * Pure reduce over a sequence of SessionEvents.
 *
 * Returns `null` if no `session:start` event is found (empty or pre-start stream).
 * Handles partial streams: a stream without `session:done` is treated as "running"
 * (or "enriching"/"verifying" depending on the last active event).
 */
export function deriveState(events: SessionEvent[]): SessionHandle | null {
  // Find the session:start event — required
  const startEvent = events.find((e) => e.type === "session:start");
  if (!startEvent || startEvent.type !== "session:start") {
    return null;
  }

  const id = deriveId(startEvent.planPath, startEvent.timestamp);

  // Mutable working state
  let status: SessionStatus = "running";
  let currentPhase: SessionHandle["currentPhase"] = undefined;
  let currentIteration: SessionHandle["currentIteration"] = undefined;
  let totalIterations = 0;
  let cost = 0;
  let lastEventAt = startEvent.timestamp;
  let error: string | undefined = undefined;
  let exitReason: string | undefined = undefined;
  let enrichProgress: SessionHandle["enrichProgress"] = undefined;
  let verifyProgress: SessionHandle["verifyProgress"] = undefined;

  for (const event of events) {
    // Always track last event timestamp
    lastEventAt = event.timestamp;

    switch (event.type) {
      case "session:start":
        // Already handled above; reset to running
        status = "running";
        break;

      case "session:done":
        status = "complete";
        exitReason = event.exitReason;
        totalIterations = event.iterations;
        if (event.cumulativeCostUsd !== undefined) {
          cost = event.cumulativeCostUsd;
        }
        break;

      case "enrich:start":
        status = "enriching";
        enrichProgress = { done: 0, total: event.fileCount };
        break;

      case "enrich:file:done":
      case "enrich:file:skip":
      case "enrich:file:error":
        if (enrichProgress) {
          enrichProgress = { done: enrichProgress.done + 1, total: enrichProgress.total };
        }
        break;

      case "enrich:file:start":
        // No state change needed
        break;

      case "enrich:done":
        status = "running";
        enrichProgress = enrichProgress
          ? { done: enrichProgress.total, total: enrichProgress.total }
          : undefined;
        break;

      case "phase:start":
        status = "running";
        currentPhase = {
          phase: event.phase,
          current: event.current,
          total: event.total,
        };
        break;

      case "phase:done":
        currentPhase = undefined;
        currentIteration = undefined;
        break;

      case "iteration:start":
        status = "running";
        currentIteration = {
          iteration: event.iteration,
          max: event.maxIterations,
        };
        break;

      case "iteration:done":
        totalIterations = event.iteration;
        currentIteration = undefined;
        if (event.costUsd !== undefined) {
          cost = event.costUsd;
        }
        break;

      case "cost:update":
        cost = event.cumulativeCostUsd;
        break;

      case "error":
        status = "error";
        error = event.message;
        break;

      case "credential:expired":
        status = "error";
        error = `Credential expired: ${event.provider} — ${event.message}`;
        break;

      case "verify:start":
        status = "verifying";
        verifyProgress = { passed: 0, total: event.itemCount };
        break;

      case "verify:result":
        if (verifyProgress) {
          verifyProgress = {
            passed: verifyProgress.passed + (event.passed ? 1 : 0),
            total: verifyProgress.total,
          };
        }
        break;

      case "verify:done":
        status = "running";
        verifyProgress = verifyProgress
          ? { passed: verifyProgress.passed, total: event.passed + event.failed }
          : undefined;
        break;

      case "tool:call":
      case "thinking":
        // No state change
        break;
    }
  }

  return {
    id,
    planPath: startEvent.planPath,
    cwd: startEvent.cwd,
    resume: startEvent.resume,
    status,
    currentPhase,
    currentIteration,
    totalIterations,
    cost,
    startedAt: startEvent.timestamp,
    lastEventAt,
    error,
    exitReason,
    enrichProgress,
    verifyProgress,
  };
}
