# Pilot state migration — workflows, phases, artifacts

## Goal

Add `workflows`, `phases`, and `artifacts` tables to the pilot SQLite state layer, and add a `phase` column to the existing `events` table. Backfill every existing `runs` row into a synthetic single-build-phase workflow so all CLI tools (`status`, `logs`, `cost`) and the worker keep working unchanged. This is the data-layer foundation for the five-phase workflow (scope → plan → build → qa → followup). Existing `runs.ts` accessors stay functional but get `@deprecated` JSDoc; new accessor modules (`workflows.ts`, `phases.ts`, `artifacts.ts`) provide the forward-looking API.

## Constraints

- **All 52 existing tests pass unchanged.** No modifications to `test/pilot-state-db.test.ts` or `test/pilot-state-accessors.test.ts` unless a schema-count assertion needs updating (e.g., if a test asserts exactly 3 tables and now there are 6).
- **Migration idempotency.** Running `applyMigrations` twice on the same DB is a no-op. The v2 migration uses `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN` guarded by a check, and `UPDATE ... WHERE phase IS NULL` for backfill.
- **`workflows.id` reuses `runs.id`.** No new ULID generation for backfilled rows. The FK from `phases` → `workflows` uses the same id.
- **Backward compatibility.** Every consumer of `runs.ts`, `tasks.ts`, `events.ts` continues to compile and behave identically. The `EventRow` type gains an optional `phase` field; `appendEvent` gains an optional `phase` parameter (defaults to `null`).
- **No consumer rewrites in this step.** `build.ts`, `build-resume.ts`, `worker.ts`, `status.ts`, `logs.ts`, `cost.ts` are NOT modified. They'll adopt the workflow API in later steps.
- **Phase names are a closed enum for now.** `scope`, `plan`, `build`, `qa`, `followup` — enforced by CHECK constraint. Extensibility comes from a future migration if needed.
- **Artifact `kind` is an open TEXT column.** No CHECK constraint — future phases will define their own artifact kinds (e.g., `scope-doc`, `plan-yaml`, `qa-report`). Validation happens at the accessor level, not the schema level.

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: A v2 migration exists that creates workflows, phases, and artifacts
         tables with correct columns, types, constraints, and foreign keys.
         The events table gains a nullable phase column. Running the migration
         on a fresh DB produces all six tables (runs, tasks, events, workflows,
         phases, artifacts) with correct schemas.
  tests:
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"v2 migration creates workflows table with correct schema"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"v2 migration creates phases table with correct schema"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"v2 migration creates artifacts table with correct schema"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"v2 migration adds phase column to events table"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"fresh DB has all six tables after migrations"
  verify: cd packages/harness-opencode && bun test test/pilot-state-migration.test.ts --test-name-pattern "v2 migration creates|fresh DB has"

- [x] id: a2
  intent: Existing runs rows are backfilled into synthetic workflows and
         build-phase rows during migration. Each run gets a workflows row
         with the same id, goal derived from plan_slug, current_phase='build',
         and a phases row with name='build' and status mirrored from the run.
         Existing events rows get phase='build' backfilled.
  tests:
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"backfill creates workflow row for each existing run"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"backfill creates build phase row for each existing run"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"backfill sets phase='build' on existing events"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"backfill mirrors run status to phase status"
  verify: cd packages/harness-opencode && bun test test/pilot-state-migration.test.ts --test-name-pattern "backfill"

- [x] id: a3
  intent: The v2 migration is idempotent — running it twice on the same DB
         produces no errors and no duplicate rows.
  tests:
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"v2 migration is idempotent"
  verify: cd packages/harness-opencode && bun test test/pilot-state-migration.test.ts --test-name-pattern "idempotent"

- [x] id: a4
  intent: New accessor modules provide CRUD for workflows, phases, and
         artifacts. Workflows can be created, queried, and transitioned.
         Phases can be created, advanced, and queried per-workflow. Artifacts
         can be recorded with sha256 and queried by workflow+phase.
  tests:
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"createWorkflow inserts a pending workflow"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"getWorkflow returns workflow by id"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"listWorkflows returns newest first"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"markWorkflowRunning transitions pending to running"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"markWorkflowFinished sets terminal status"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"advancePhase updates current_phase"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"createPhase inserts a phase row"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"getPhase returns phase by workflow and name"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"listPhases returns phases for a workflow"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"markPhaseRunning transitions pending to running"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"markPhaseFinished sets terminal status and finished_at"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"recordArtifact inserts an artifact row"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"listArtifacts returns artifacts for workflow+phase"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"artifact sha256 is stored and retrievable"
  verify: cd packages/harness-opencode && bun test test/pilot-state-workflows.test.ts

- [x] id: a5
  intent: Existing runs.ts accessors continue to work and are marked
         @deprecated. All 52 pre-existing tests pass without modification.
         The events accessor accepts an optional phase parameter.
  tests:
    - packages/harness-opencode/test/pilot-state-db.test.ts::"openStateDb — schema creation"
    - packages/harness-opencode/test/pilot-state-accessors.test.ts::"run lifecycle"
  verify: cd packages/harness-opencode && bun test test/pilot-state-db.test.ts test/pilot-state-accessors.test.ts

- [x] id: a6
  intent: The full test suite passes — no regressions anywhere in the
         package.
  tests:
    - packages/harness-opencode/test/pilot-state-db.test.ts::"*"
    - packages/harness-opencode/test/pilot-state-accessors.test.ts::"*"
    - packages/harness-opencode/test/pilot-state-migration.test.ts::"*"
    - packages/harness-opencode/test/pilot-state-workflows.test.ts::"*"
  verify: cd packages/harness-opencode && bun test
```

## File-level changes

### `packages/harness-opencode/src/pilot/state/migrations.ts`
- Change: Add `V2_SQL` constant and append v2 entry to `MIGRATIONS` array. The v2 SQL creates `workflows`, `phases`, `artifacts` tables, adds `phase` column to `events`, backfills existing `runs` into `workflows`+`phases`, and backfills `events.phase` to `'build'`.
- Why: This is the core deliverable — the schema migration.
- Risk: medium — backfill SQL must handle all five run statuses correctly and map them to phase statuses. The `ALTER TABLE events ADD COLUMN` must be guarded for idempotency since SQLite doesn't support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`.

### `packages/harness-opencode/src/pilot/state/types.ts`
- Change: Add `WorkflowRow`, `PhaseRow`, `ArtifactRow` types. Add `WORKFLOW_STATUSES`, `WorkflowStatus`, `PHASE_NAMES`, `PhaseName`, `PHASE_STATUSES`, `PhaseStatus` constants and types. Update `EventRow` to include optional `phase: string | null` field.
- Why: Type definitions for the new tables and the extended events row.
- Risk: low — additive only. `EventRow` gains a field that's `null` for legacy rows, which is backward-compatible since existing code doesn't destructure or spread it in a way that would break.

### `packages/harness-opencode/src/pilot/state/workflows.ts` (NEW)
- Change: Create accessor module with `createWorkflow`, `getWorkflow`, `listWorkflows`, `latestWorkflow`, `markWorkflowRunning`, `markWorkflowFinished`, `advancePhase`.
- Why: Forward-looking API for workflow lifecycle management.
- Risk: low — new file, no existing code affected.

### `packages/harness-opencode/src/pilot/state/phases.ts` (NEW)
- Change: Create accessor module with `createPhase`, `getPhase`, `listPhases`, `markPhaseRunning`, `markPhaseFinished`.
- Why: Forward-looking API for phase lifecycle management.
- Risk: low — new file, no existing code affected.

### `packages/harness-opencode/src/pilot/state/artifacts.ts` (NEW)
- Change: Create accessor module with `recordArtifact`, `getArtifact`, `listArtifacts`.
- Why: Forward-looking API for artifact tracking (plan files, QA reports, scope docs).
- Risk: low — new file, no existing code affected.

### `packages/harness-opencode/src/pilot/state/runs.ts`
- Change: Add `@deprecated` JSDoc to all 7 exported functions (`createRun`, `getRun`, `listRuns`, `latestRun`, `markRunRunning`, `markRunFinished`, `markRunResumed`). Each deprecation notice points to the workflow equivalent.
- Why: Signal to future consumers that the workflow API is the forward path, without breaking any existing code.
- Risk: none — JSDoc-only change.

### `packages/harness-opencode/src/pilot/state/events.ts`
- Change: Add optional `phase?: string | null` parameter to `appendEvent`'s args. Include `phase` in the INSERT statement (defaulting to `null` when not provided). Update `readEvents` and `readEventsDecoded` SELECT to include the `phase` column. Update the subscriber fan-out payload to include `phase`.
- Why: Events need phase association for the multi-phase workflow. Existing callers that don't pass `phase` get `null`, preserving backward compatibility.
- Risk: low — the INSERT adds one column; existing callers omit it and get `null`.

### `packages/harness-opencode/test/pilot-state-migration.test.ts` (NEW)
- Change: Create test file covering: fresh-DB schema validation (all 6 tables present with correct columns), backfill correctness (v1 fixture → v2 produces correct workflow/phase/event rows), idempotency (running migration twice is a no-op), status mapping (all 5 run statuses map correctly to phase statuses).
- Why: The migration is the highest-risk piece; thorough testing prevents data corruption on upgrade.
- Risk: low — new test file.

### `packages/harness-opencode/test/pilot-state-workflows.test.ts` (NEW)
- Change: Create test file covering: workflow CRUD, phase transitions (pending → running → completed/failed), artifact recording with sha256, phase name CHECK constraint enforcement, FK cascade from workflows → phases → artifacts.
- Why: Validates the new accessor API before any consumer adopts it.
- Risk: low — new test file.

### `packages/harness-opencode/test/pilot-state-db.test.ts`
- Change: If the existing test asserts a specific table count (e.g., "schema creates 3 tables"), update the assertion to account for the 3 new tables (workflows, phases, artifacts → total 6 user tables + _migrations). If no such assertion exists, no change needed.
- Why: The v2 migration adds tables that a table-count assertion would catch.
- Risk: low — minor assertion update if needed. (Resolved: no table-count assertion exists; no change needed.)

### `packages/harness-opencode/test/pilot-worker-status-integration.test.ts`
- Change: Add `phase TEXT` column to the integration test helper's hand-rolled `CREATE TABLE events` statement, keeping it in sync with the v2 migration's schema.
- Why: `appendEvent` now always inserts the `phase` column; the test helper's raw CREATE TABLE must match.
- Risk: none — 3-line change to a test helper.

## Test plan

### New test files
1. **`test/pilot-state-migration.test.ts`** — Migration-specific tests:
   - Fresh DB: all 6 tables exist with correct column names and types
   - Fresh DB: CHECK constraints on `workflows.status`, `phases.name`, `phases.status` are enforced
   - Fresh DB: FK constraints (phases → workflows, artifacts → workflows) are enforced
   - Backfill: create a v1-only DB (insert runs + tasks + events manually), then apply v2 migration, verify workflows/phases/events rows
   - Backfill status mapping: test all 5 run statuses (`pending`, `running`, `completed`, `aborted`, `failed`) map to correct phase statuses
   - Backfill: `events.phase` is `'build'` for all pre-existing rows
   - Idempotency: apply v2 twice, verify no errors and no duplicate rows
   - `_migrations` table has version 2 entry after migration

2. **`test/pilot-state-workflows.test.ts`** — Accessor tests:
   - Workflow CRUD: create, get, list (newest-first), latest
   - Workflow transitions: pending → running, running → completed/failed/aborted
   - Illegal transitions: reject invalid status moves
   - Phase CRUD: create, get, list per workflow
   - Phase transitions: pending → running → completed/failed
   - Phase name constraint: reject invalid phase names
   - `advancePhase`: updates `current_phase` on workflow row
   - Artifact CRUD: record, get, list by workflow+phase
   - Artifact sha256: stored and retrievable
   - FK cascades: deleting a workflow cascades to phases and artifacts
   - `appendEvent` with `phase` parameter: stores and retrieves correctly

### Existing test verification
- Run `bun test test/pilot-state-db.test.ts test/pilot-state-accessors.test.ts` — all 52 tests pass unchanged (or with minimal table-count assertion update).
- Run `bun test` (full suite) — no regressions.

## Implementation notes

### V2 migration SQL structure

The migration SQL needs careful ordering:

1. **Create `workflows` table** — `id TEXT PK, goal TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL CHECK(...), current_phase TEXT`. No FK to `runs` — the id is shared by convention, not by constraint, to avoid circular dependencies.

2. **Create `phases` table** — `(workflow_id TEXT NOT NULL, name TEXT NOT NULL CHECK(name IN ('scope','plan','build','qa','followup')), status TEXT NOT NULL CHECK(...), started_at INTEGER, finished_at INTEGER, artifact_path TEXT, PRIMARY KEY (workflow_id, name), FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE)`.

3. **Create `artifacts` table** — `(id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, phase TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, sha256 TEXT, FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE)`. Index on `(workflow_id, phase)`.

4. **Add `phase` column to `events`** — SQLite doesn't support `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Guard with: check `PRAGMA table_info(events)` for `phase` column existence before running `ALTER TABLE events ADD COLUMN phase TEXT`. This check runs inside the migration transaction.

5. **Backfill `workflows`** — `INSERT INTO workflows (id, goal, started_at, finished_at, status, current_phase) SELECT id, plan_slug, started_at, finished_at, status, 'build' FROM runs`.

6. **Backfill `phases`** — `INSERT INTO phases (workflow_id, name, status, started_at, finished_at, artifact_path) SELECT id, 'build', status, started_at, finished_at, NULL FROM runs`.

7. **Backfill `events.phase`** — `UPDATE events SET phase = 'build' WHERE phase IS NULL`.

### Status mapping

- `WorkflowStatus` reuses the same values as `RunStatus`: `pending`, `running`, `completed`, `aborted`, `failed`.
- `PhaseStatus` also uses the same values: `pending`, `running`, `completed`, `aborted`, `failed`. This allows direct mapping during backfill (`runs.status` → `phases.status`).
- `PhaseName` is a closed enum: `scope`, `plan`, `build`, `qa`, `followup`.

### ALTER TABLE idempotency pattern

Since `applyMigrations` already tracks applied versions in `_migrations`, the v2 migration will only run once per DB. However, for defense-in-depth, the `CREATE TABLE IF NOT EXISTS` and the column-existence check before `ALTER TABLE` ensure the SQL is safe even if somehow re-executed.

The recommended pattern for the ALTER TABLE guard in the migration SQL (since this runs via `db.exec` or statement splitting):

```sql
-- This must be done programmatically in TypeScript, not in raw SQL,
-- because SQLite doesn't support conditional ALTER TABLE.
```

Alternative: make the v2 migration a hybrid — the `CREATE TABLE` statements go in the SQL string, but the `ALTER TABLE` and backfill are done programmatically. This requires extending the `Migration` type to support a `run(db)` function alongside or instead of `sql`. **Simpler approach:** keep it all in SQL but use the fact that `ALTER TABLE ADD COLUMN` on an existing column throws, and catch the error. Since the migration runner already wraps each migration in a transaction, a thrown error would roll back. Better: check `_migrations` tracking (which already prevents re-execution) and trust it.

**Decision: trust the `_migrations` guard.** The v2 SQL runs exactly once per DB. Use plain `ALTER TABLE events ADD COLUMN phase TEXT` without a guard. If someone manually corrupts `_migrations`, they get an error — that's acceptable.

## Out of scope

- **Consumer migration.** `build.ts`, `build-resume.ts`, `worker.ts`, `status.ts`, `logs.ts`, `cost.ts` are NOT updated to use the workflow API. That's Steps 4–8.
- **Workflow orchestrator.** No phase-transition engine or multi-phase runner. This step only provides the data layer.
- **Plan schema changes.** The `pilot.yaml` schema is not modified. Workflow metadata (goal, phases) will be derived from plan + CLI context in later steps.
- **CLI changes.** No new CLI verbs or flags. `pilot status` continues to read from `runs`/`tasks` tables.
- **Changeset.** Not created in this step — the TODO checklist says "commit and push" but doesn't specify a changeset. The migration is internal (no published API change yet).

## Open questions

- ~~**`workflows.goal` nullability** — Resolved: `NOT NULL`. Backfill derives from `plan_slug`; future workflows always have a goal from CLI/plan context.~~
- ~~**`phases.artifact_path` location** — Resolved: keep on `phases` table as primary-output shortcut AND in `artifacts` table as detailed manifest.~~
- **Existing `pilot-state-db.test.ts` table-count assertion.** The builder should check whether this test asserts a specific number of tables during implementation. If so, update the count from 3 to 6 (user tables). If it only checks that specific tables exist by name, no change needed.
