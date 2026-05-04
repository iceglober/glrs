/**
 * Shared types and enums for pilot state accessors.
 *
 * Lives in its own file so `runs.ts`, `tasks.ts`, and `events.ts` can
 * import without a circular dep, and so consumers (the worker, the CLI)
 * can pick up just the types without hauling in `bun:sqlite`.
 */

// --- Status enums ----------------------------------------------------------

/**
 * Run-level status. Lifecycle:
 *
 *   pending  →  running  →  completed | aborted | failed
 *
 *   - `pending`: row created, worker not yet started
 *   - `running`: worker is actively processing tasks
 *   - `completed`: every task succeeded
 *   - `aborted`: user cancelled (ctrl-c, kill); some tasks may have
 *     succeeded
 *   - `failed`: at least one task failed AND the run terminated (no
 *     in-flight retries)
 */
export const RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "aborted",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Task-level status. Lifecycle:
 *
 *   pending  →  ready  →  running  →  succeeded
 *                              ↘  failed | blocked | aborted
 *
 *   - `pending`: not yet runnable (deps unsatisfied)
 *   - `ready`:   deps satisfied, queued for a worker
 *   - `running`: worker has acquired the task
 *   - `succeeded`: agent completed AND verify passed AND touches enforced
 *   - `failed`: agent gave up after max attempts OR verify never passed
 *   - `blocked`: a transitive dependency failed; this task will not run
 *   - `aborted`: explicit cancellation while running
 */
export const TASK_STATUSES = [
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "aborted",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// --- Row shapes (read-only views from the DB) ------------------------------

export type RunRow = {
  id: string;
  plan_path: string;
  plan_slug: string;
  started_at: number;
  finished_at: number | null;
  status: RunStatus;
};

export type TaskRow = {
  run_id: string;
  task_id: string;
  status: TaskStatus;
  attempts: number;
  session_id: string | null;
  branch: string | null;
  worktree_path: string | null;
  started_at: number | null;
  finished_at: number | null;
  cost_usd: number;
  last_error: string | null;
};

export type EventRow = {
  id: number;
  run_id: string;
  task_id: string | null;
  ts: number;
  kind: string;
  /** JSON-encoded payload as stored in the DB. */
  payload: string;
  /** Phase name associated with this event, or null for legacy/run-level events. */
  phase: string | null;
};

// --- Workflow / phase / artifact types -------------------------------------

/**
 * Workflow-level status. Mirrors RunStatus — same lifecycle, same values.
 * Direct mapping allows backfill from runs.status without transformation.
 *
 *   pending  →  running  →  completed | aborted | failed
 */
export const WORKFLOW_STATUSES = [
  "pending",
  "running",
  "completed",
  "aborted",
  "failed",
] as const satisfies readonly string[];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * Phase names — closed enum for the five-phase workflow.
 * Extensibility comes from a future migration if needed.
 */
export const PHASE_NAMES = [
  "scope",
  "plan",
  "build",
  "qa",
  "followup",
] as const satisfies readonly string[];
export type PhaseName = (typeof PHASE_NAMES)[number];

/**
 * Phase-level status. Same values as WorkflowStatus — allows direct
 * backfill from runs.status → phases.status.
 */
export const PHASE_STATUSES = [
  "pending",
  "running",
  "completed",
  "aborted",
  "failed",
] as const satisfies readonly string[];
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

// --- Row shapes for new tables ---------------------------------------------

export type WorkflowRow = {
  id: string;
  goal: string;
  started_at: number;
  finished_at: number | null;
  status: WorkflowStatus;
  current_phase: string | null;
};

export type PhaseRow = {
  workflow_id: string;
  name: PhaseName;
  status: PhaseStatus;
  started_at: number | null;
  finished_at: number | null;
  artifact_path: string | null;
};

export type ArtifactRow = {
  id: number;
  workflow_id: string;
  phase: string;
  kind: string;
  path: string;
  created_at: number;
  sha256: string | null;
};
