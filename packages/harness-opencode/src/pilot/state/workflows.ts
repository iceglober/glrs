/**
 * Workflow-level state accessors.
 *
 * A workflow is the top-level unit of the five-phase execution model
 * (scope → plan → build → qa → followup). Each workflow has a goal
 * (human-readable description), a current phase, and a lifecycle status.
 *
 * For v0.x, workflows map 1:1 with runs — the v2 migration backfills
 * every existing run into a synthetic single-build-phase workflow. New
 * workflows created via `createWorkflow` are independent of runs.
 *
 * Ship-checklist alignment: Phase B3 of `PILOT_TODO.md`.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "ulid";

import type { WorkflowRow, WorkflowStatus } from "./types.js";

// --- Public API ------------------------------------------------------------

/**
 * Create a new workflow row with status `pending` and `started_at = now`.
 *
 * Returns the generated workflow id (ULID).
 */
export function createWorkflow(
  db: Database,
  args: { goal: string; now?: number },
): string {
  const id = ulid();
  const now = args.now ?? Date.now();
  db.run(
    `INSERT INTO workflows (id, goal, started_at, status, current_phase)
     VALUES (?, ?, ?, 'pending', NULL)`,
    [id, args.goal, now],
  );
  return id;
}

/**
 * Read a single workflow by id. Returns `null` if not found.
 */
export function getWorkflow(db: Database, workflowId: string): WorkflowRow | null {
  return db
    .query("SELECT * FROM workflows WHERE id=?")
    .get(workflowId) as WorkflowRow | null;
}

/**
 * List workflows, newest-first by `started_at`. Default limit 100.
 */
export function listWorkflows(db: Database, limit = 100): WorkflowRow[] {
  return db
    .query("SELECT * FROM workflows ORDER BY started_at DESC LIMIT ?")
    .all(limit) as WorkflowRow[];
}

/**
 * Latest workflow (newest `started_at`). Returns `null` if none exist.
 */
export function latestWorkflow(db: Database): WorkflowRow | null {
  return db
    .query("SELECT * FROM workflows ORDER BY started_at DESC LIMIT 1")
    .get() as WorkflowRow | null;
}

/**
 * Transition a workflow to `running`. Idempotent if already running.
 * Throws if the workflow does not exist or is in a non-pending status.
 */
export function markWorkflowRunning(db: Database, workflowId: string): void {
  const cur = getWorkflow(db, workflowId);
  if (!cur) {
    throw new Error(`markWorkflowRunning: workflow ${JSON.stringify(workflowId)} not found`);
  }
  if (cur.status === "running") return;
  if (cur.status !== "pending") {
    throw new Error(
      `markWorkflowRunning: cannot move workflow ${JSON.stringify(workflowId)} from ${cur.status} to running`,
    );
  }
  db.run("UPDATE workflows SET status='running' WHERE id=?", [workflowId]);
}

/**
 * Terminate a workflow with a terminal status (`completed`, `aborted`, `failed`).
 * Stamps `finished_at` to `now`. Throws if the workflow doesn't exist or
 * `status` is not a terminal value.
 */
export function markWorkflowFinished(
  db: Database,
  workflowId: string,
  status: WorkflowStatus,
  now: number = Date.now(),
): void {
  if (status !== "completed" && status !== "aborted" && status !== "failed") {
    throw new Error(
      `markWorkflowFinished: ${JSON.stringify(status)} is not a terminal status`,
    );
  }
  const cur = getWorkflow(db, workflowId);
  if (!cur) {
    throw new Error(`markWorkflowFinished: workflow ${JSON.stringify(workflowId)} not found`);
  }
  db.run(
    "UPDATE workflows SET status=?, finished_at=? WHERE id=?",
    [status, now, workflowId],
  );
}

/**
 * Update `current_phase` on a workflow row. Used when the orchestrator
 * advances from one phase to the next.
 *
 * Does not validate the phase name — callers should use `PhaseName` values.
 * Throws if the workflow does not exist.
 */
export function advancePhase(
  db: Database,
  workflowId: string,
  phase: string,
): void {
  const cur = getWorkflow(db, workflowId);
  if (!cur) {
    throw new Error(`advancePhase: workflow ${JSON.stringify(workflowId)} not found`);
  }
  db.run("UPDATE workflows SET current_phase=? WHERE id=?", [phase, workflowId]);
}
