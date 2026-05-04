/**
 * Run-level state accessors.
 *
 * One run = one `pilot build` invocation. The `runs` table is small
 * (one row per build) and changes ~5 times across a run's lifetime
 * (created, marked running, marked finished). Accessors here are
 * intentionally minimal — no batching, no caching.
 *
 * `Runs.create` is the single source of truth for ULID generation: it
 * receives a `Plan` + path + slug and returns the new run-id. Callers
 * (the CLI's `pilot build`) should not generate IDs themselves.
 *
 * Ship-checklist alignment: Phase B2 of `PILOT_TODO.md`.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "ulid";

import type { Plan } from "../plan/schema.js";
import type { RunRow, RunStatus } from "./types.js";

// --- Public API ------------------------------------------------------------

/**
 * Create a new run row with status `pending` and `started_at = now()`.
 *
 * Returns the generated run-id (ULID). The caller pairs this with
 * `Tasks.upsertFromPlan(runId, plan)` to populate the task rows.
 *
 * @deprecated Use `createWorkflow` from `./workflows.js` instead.
 * The `runs` table is superseded by the `workflows`/`phases` tables
 * introduced in the v2 migration. Existing callers continue to work
 * unchanged; new code should use the workflow API.
 */
export function createRun(
  db: Database,
  args: { plan: Plan; planPath: string; slug: string; now?: number },
): string {
  const id = ulid();
  const now = args.now ?? Date.now();
  db.run(
    `INSERT INTO runs (id, plan_path, plan_slug, started_at, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [id, args.planPath, args.slug, now],
  );
  // Plan name is captured indirectly via plan_path; if needed for
  // status output, callers re-load the plan. We deliberately don't
  // denormalize plan.name here — single source of truth is the YAML.
  void args.plan;
  return id;
}

/**
 * Transition a run to `running`. Idempotent — a no-op if the run is
 * already in `running`. Throws if the run does not exist.
 *
 * @deprecated Use `markWorkflowRunning` from `./workflows.js` instead.
 */
export function markRunRunning(db: Database, runId: string): void {
  const cur = getRun(db, runId);
  if (!cur) throw new Error(`markRunRunning: run ${JSON.stringify(runId)} not found`);
  if (cur.status === "running") return;
  if (cur.status !== "pending") {
    throw new Error(
      `markRunRunning: cannot move run ${JSON.stringify(runId)} from ${cur.status} to running`,
    );
  }
  db.run("UPDATE runs SET status='running' WHERE id=?", [runId]);
}

/**
 * Terminate a run with `completed` / `aborted` / `failed`. Stamps
 * `finished_at` to `now`. Throws if `runId` doesn't exist or `status` is
 * not a terminal status.
 *
 * @deprecated Use `markWorkflowFinished` from `./workflows.js` instead.
 */
export function markRunFinished(
  db: Database,
  runId: string,
  status: RunStatus,
  now: number = Date.now(),
): void {
  if (status !== "completed" && status !== "aborted" && status !== "failed") {
    throw new Error(
      `markRunFinished: ${JSON.stringify(status)} is not a terminal status`,
    );
  }
  const cur = getRun(db, runId);
  if (!cur) {
    throw new Error(`markRunFinished: run ${JSON.stringify(runId)} not found`);
  }
  db.run("UPDATE runs SET status=?, finished_at=? WHERE id=?", [status, now, runId]);
}

/**
 * Transition a run from a terminal status (`failed` / `aborted`) back to
 * `running` for a resume. Clears `finished_at` so the run's timing
 * reflects the current attempt.
 *
 * Refuses to resume a `completed` run (nothing to do). Allows resume
 * from `pending` (edge case: interrupted before markRunRunning) or
 * `running` (edge case: prior process died without marking finished).
 *
 * @deprecated Use the workflow API from `./workflows.js` instead.
 */
export function markRunResumed(db: Database, runId: string): void {
  const cur = getRun(db, runId);
  if (!cur) throw new Error(`markRunResumed: run ${JSON.stringify(runId)} not found`);
  if (cur.status === "completed") {
    throw new Error(
      `markRunResumed: run ${JSON.stringify(runId)} is already completed; nothing to resume`,
    );
  }
  db.run("UPDATE runs SET status='running', finished_at=NULL WHERE id=?", [runId]);
}

/**
 * Read a single run by id. Returns `null` if not found (caller decides
 * whether that's an error).
 *
 * @deprecated Use `getWorkflow` from `./workflows.js` instead.
 */
export function getRun(db: Database, runId: string): RunRow | null {
  const row = db
    .query("SELECT * FROM runs WHERE id=?")
    .get(runId) as RunRow | null;
  return row;
}

/**
 * List runs, newest-first. Default limit 100; `pilot status` and
 * `pilot logs` use this for "latest run" lookups.
 *
 * @deprecated Use `listWorkflows` from `./workflows.js` instead.
 */
export function listRuns(db: Database, limit = 100): RunRow[] {
  return db
    .query("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as RunRow[];
}

/**
 * Latest run (newest `started_at`). Convenience wrapper for the most
 * common CLI lookup. Returns `null` if no runs exist.
 *
 * @deprecated Use `latestWorkflow` from `./workflows.js` instead.
 */
export function latestRun(db: Database): RunRow | null {
  const row = db
    .query("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1")
    .get() as RunRow | null;
  return row;
}
