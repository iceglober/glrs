/**
 * Artifact accessors.
 *
 * Artifacts are files produced by a phase (e.g., scope-doc, plan-yaml,
 * qa-report). Each artifact row records the workflow, phase, kind (open
 * TEXT — no CHECK constraint), filesystem path, creation timestamp, and
 * optional sha256 for integrity verification.
 *
 * Ship-checklist alignment: Phase B3 of `PILOT_TODO.md`.
 */

import type { Database } from "bun:sqlite";

import type { ArtifactRow } from "./types.js";

// --- Public API ------------------------------------------------------------

/**
 * Record a new artifact. Returns the auto-incremented row id.
 *
 * `kind` is open TEXT — callers define their own artifact kinds
 * (e.g., `scope-doc`, `plan-yaml`, `qa-report`).
 *
 * `sha256` is optional; pass `null` if not computed.
 */
export function recordArtifact(
  db: Database,
  args: {
    workflowId: string;
    phase: string;
    kind: string;
    path: string;
    sha256?: string | null;
    now?: number;
  },
): number {
  const now = args.now ?? Date.now();
  const result = db.run(
    `INSERT INTO artifacts (workflow_id, phase, kind, path, created_at, sha256)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [args.workflowId, args.phase, args.kind, args.path, now, args.sha256 ?? null],
  );
  return result.lastInsertRowid as number;
}

/**
 * Read a single artifact by id. Returns `null` if not found.
 */
export function getArtifact(db: Database, id: number): ArtifactRow | null {
  return db
    .query("SELECT * FROM artifacts WHERE id=?")
    .get(id) as ArtifactRow | null;
}

/**
 * List artifacts for a workflow, optionally filtered by phase.
 * Returns rows ordered by `created_at ASC` (insertion order).
 */
export function listArtifacts(
  db: Database,
  args: { workflowId: string; phase?: string },
): ArtifactRow[] {
  if (args.phase !== undefined) {
    return db
      .query(
        "SELECT * FROM artifacts WHERE workflow_id=? AND phase=? ORDER BY created_at ASC",
      )
      .all(args.workflowId, args.phase) as ArtifactRow[];
  }
  return db
    .query(
      "SELECT * FROM artifacts WHERE workflow_id=? ORDER BY created_at ASC",
    )
    .all(args.workflowId) as ArtifactRow[];
}
