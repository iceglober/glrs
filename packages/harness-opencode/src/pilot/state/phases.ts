/**
 * Phase-level state accessors.
 *
 * A phase is one step in the five-phase workflow (scope → plan → build →
 * qa → followup). Each workflow has at most one row per phase name.
 * The composite PK (workflow_id, name) enforces this at the DB level.
 *
 * Ship-checklist alignment: Phase B3 of `PILOT_TODO.md`.
 */

import type { Database } from "bun:sqlite";

import type { PhaseRow, PhaseName, PhaseStatus } from "./types.js";

// --- Public API ------------------------------------------------------------

/**
 * Create a new phase row with status `pending`.
 *
 * Throws if a phase with the same (workflow_id, name) already exists
 * (PK violation) or if the workflow_id doesn't exist (FK violation).
 */
export function createPhase(
  db: Database,
  args: { workflowId: string; name: PhaseName },
): void {
  db.run(
    `INSERT INTO phases (workflow_id, name, status, started_at, finished_at, artifact_path)
     VALUES (?, ?, 'pending', NULL, NULL, NULL)`,
    [args.workflowId, args.name],
  );
}

/**
 * Read a single phase by (workflow_id, name). Returns `null` if not found.
 */
export function getPhase(
  db: Database,
  workflowId: string,
  name: PhaseName,
): PhaseRow | null {
  return db
    .query("SELECT * FROM phases WHERE workflow_id=? AND name=?")
    .get(workflowId, name) as PhaseRow | null;
}

/**
 * List all phases for a workflow, in definition order
 * (scope, plan, build, qa, followup).
 */
export function listPhases(db: Database, workflowId: string): PhaseRow[] {
  // ORDER BY CASE preserves the canonical phase order regardless of
  // insertion order.
  return db
    .query(`
      SELECT * FROM phases WHERE workflow_id=?
      ORDER BY CASE name
        WHEN 'scope'    THEN 1
        WHEN 'plan'     THEN 2
        WHEN 'build'    THEN 3
        WHEN 'qa'       THEN 4
        WHEN 'followup' THEN 5
        ELSE 99
      END
    `)
    .all(workflowId) as PhaseRow[];
}

/**
 * Transition a phase to `running`. Idempotent if already running.
 * Throws if the phase does not exist or is not in `pending` status.
 */
export function markPhaseRunning(
  db: Database,
  workflowId: string,
  name: PhaseName,
  now: number = Date.now(),
): void {
  const cur = getPhase(db, workflowId, name);
  if (!cur) {
    throw new Error(
      `markPhaseRunning: phase ${JSON.stringify(name)} not found for workflow ${JSON.stringify(workflowId)}`,
    );
  }
  if (cur.status === "running") return;
  if (cur.status !== "pending") {
    throw new Error(
      `markPhaseRunning: cannot move phase ${JSON.stringify(name)} from ${cur.status} to running`,
    );
  }
  db.run(
    "UPDATE phases SET status='running', started_at=? WHERE workflow_id=? AND name=?",
    [now, workflowId, name],
  );
}

/**
 * Terminate a phase with a terminal status (`completed`, `aborted`, `failed`).
 * Stamps `finished_at` to `now`. Throws if the phase doesn't exist or
 * `status` is not a terminal value.
 */
export function markPhaseFinished(
  db: Database,
  workflowId: string,
  name: PhaseName,
  status: PhaseStatus,
  now: number = Date.now(),
): void {
  if (status !== "completed" && status !== "aborted" && status !== "failed") {
    throw new Error(
      `markPhaseFinished: ${JSON.stringify(status)} is not a terminal status`,
    );
  }
  const cur = getPhase(db, workflowId, name);
  if (!cur) {
    throw new Error(
      `markPhaseFinished: phase ${JSON.stringify(name)} not found for workflow ${JSON.stringify(workflowId)}`,
    );
  }
  db.run(
    "UPDATE phases SET status=?, finished_at=? WHERE workflow_id=? AND name=?",
    [status, now, workflowId, name],
  );
}
