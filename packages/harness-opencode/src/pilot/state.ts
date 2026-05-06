/**
 * Pilot v2 state — SQLite with two tables.
 *
 * workflows: one row per `pilot scope` + `pilot go` invocation.
 * events:    append-only structured event log.
 *
 * Schema is intentionally minimal. No runs/tasks/phases/artifacts tables.
 * The event log is the source of truth for what happened; the workflow row
 * is just the lifecycle handle.
 */

import { Database } from "bun:sqlite";
import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | "pending"
  | "scoped"
  | "planned"
  | "executing"
  | "assessing"
  | "completed"
  | "failed";

export type WorkflowRow = {
  id: string;
  goal: string;
  scope_path: string | null;
  plan_path: string | null;
  status: WorkflowStatus;
  started_at: number;
  finished_at: number | null;
  config: string | null; // JSON snapshot of PilotConfig
};

export type EventRow = {
  id: number;
  workflow_id: string;
  ts: number;
  phase: string;
  kind: string;
  task_id: string | null;
  payload: string;
  session_id: string | null;
};

export type OpenedDb = {
  db: Database;
  close: () => void;
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT    NOT NULL PRIMARY KEY,
  goal        TEXT    NOT NULL,
  scope_path  TEXT,
  plan_path   TEXT,
  status      TEXT    NOT NULL CHECK (status IN (
    'pending','scoped','planned','executing','assessing','completed','failed'
  )),
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  config      TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  phase       TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  task_id     TEXT,
  payload     TEXT    NOT NULL,
  session_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_workflow ON events(workflow_id, id);
CREATE INDEX IF NOT EXISTS idx_events_workflow_phase ON events(workflow_id, phase, id);
`.trim();

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export function openStateDb(dbPath: string): OpenedDb {
  const db = new Database(dbPath, { create: true });

  try {
    db.run("PRAGMA foreign_keys = ON");
    if (dbPath !== ":memory:") {
      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA synchronous = NORMAL");
    }
  } catch (err) {
    db.close();
    throw new Error(
      `openStateDb: failed to set PRAGMAs on ${JSON.stringify(dbPath)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    db.exec(SCHEMA_SQL);
  } catch (err) {
    db.close();
    throw err;
  }

  return { db, close: () => db.close() };
}

// ---------------------------------------------------------------------------
// Workflow accessors
// ---------------------------------------------------------------------------

export function createWorkflow(
  db: Database,
  opts: { goal: string; config?: string; now?: number },
): string {
  const id = ulid();
  const now = opts.now ?? Date.now();
  db.prepare(
    `INSERT INTO workflows (id, goal, status, started_at, config)
     VALUES (?, ?, 'pending', ?, ?)`,
  ).run(id, opts.goal, now, opts.config ?? null);
  return id;
}

export function getWorkflow(db: Database, id: string): WorkflowRow | null {
  return db.prepare(
    `SELECT * FROM workflows WHERE id = ?`,
  ).get(id) as WorkflowRow | null;
}

export function listWorkflows(db: Database, limit = 50): WorkflowRow[] {
  return db.prepare(
    `SELECT * FROM workflows ORDER BY started_at DESC LIMIT ?`,
  ).all(limit) as WorkflowRow[];
}

export function latestWorkflow(db: Database): WorkflowRow | null {
  return db.prepare(
    `SELECT * FROM workflows ORDER BY started_at DESC LIMIT 1`,
  ).get() as WorkflowRow | null;
}

export function updateWorkflowStatus(
  db: Database,
  id: string,
  status: WorkflowStatus,
  opts: { scopePath?: string; planPath?: string; now?: number } = {},
): void {
  const now = opts.now ?? Date.now();
  const terminal = status === "completed" || status === "failed";
  db.prepare(
    `UPDATE workflows
     SET status = ?,
         scope_path = COALESCE(?, scope_path),
         plan_path  = COALESCE(?, plan_path),
         finished_at = CASE WHEN ? THEN ? ELSE finished_at END
     WHERE id = ?`,
  ).run(
    status,
    opts.scopePath ?? null,
    opts.planPath ?? null,
    terminal ? 1 : 0,
    terminal ? now : null,
    id,
  );
}

// ---------------------------------------------------------------------------
// Event accessors
// ---------------------------------------------------------------------------

export function appendEvent(
  db: Database,
  opts: {
    workflowId: string;
    phase: string;
    kind: string;
    payload: unknown;
    taskId?: string;
    sessionId?: string;
    now?: number;
  },
): void {
  const ts = opts.now ?? Date.now();
  let payloadStr: string;
  try {
    payloadStr = JSON.stringify(opts.payload);
  } catch {
    payloadStr = JSON.stringify({ _serializationError: true });
  }

  db.prepare(
    `INSERT INTO events (workflow_id, ts, phase, kind, task_id, payload, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.workflowId,
    ts,
    opts.phase,
    opts.kind,
    opts.taskId ?? null,
    payloadStr,
    opts.sessionId ?? null,
  );
}

export function readEvents(
  db: Database,
  opts: { workflowId: string; phase?: string; limit?: number },
): EventRow[] {
  if (opts.phase) {
    return db.prepare(
      `SELECT * FROM events WHERE workflow_id = ? AND phase = ? ORDER BY id LIMIT ?`,
    ).all(opts.workflowId, opts.phase, opts.limit ?? 1000) as EventRow[];
  }
  return db.prepare(
    `SELECT * FROM events WHERE workflow_id = ? ORDER BY id LIMIT ?`,
  ).all(opts.workflowId, opts.limit ?? 1000) as EventRow[];
}

// ---------------------------------------------------------------------------
// Structured stderr logging
// ---------------------------------------------------------------------------

/**
 * Emit a structured log line to stderr AND append to the event log.
 * Format: [pilot] <kind>  <key=value ...>
 */
export function logEvent(
  db: Database,
  opts: {
    workflowId: string;
    phase: string;
    kind: string;
    payload: Record<string, unknown>;
    taskId?: string;
    sessionId?: string;
    indent?: number;
  },
): void {
  appendEvent(db, opts);

  const indent = "  ".repeat(opts.indent ?? 0);
  const kvPairs = Object.entries(opts.payload)
    .map(([k, v]) => {
      const val = typeof v === "string" && v.includes(" ") ? `"${v}"` : String(v);
      return `${k}=${val}`;
    })
    .join(" ");
  const line = `${indent}[pilot] ${opts.kind.padEnd(32)} ${kvPairs}\n`;
  process.stderr.write(line);
}
