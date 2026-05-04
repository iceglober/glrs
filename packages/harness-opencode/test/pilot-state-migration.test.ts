// pilot-state-migration.test.ts — tests for the v2 schema migration.
//
// Coverage:
//   - Fresh DB: all 6 user tables present with correct columns
//   - Fresh DB: CHECK constraints on workflows.status, phases.name, phases.status
//   - Fresh DB: FK constraints (phases → workflows, artifacts → workflows)
//   - Backfill: v1-only DB → v2 produces correct workflow/phase/event rows
//   - Backfill: all 5 run statuses map correctly to phase statuses
//   - Backfill: events.phase is 'build' for all pre-existing rows
//   - Idempotency: running v2 migration twice is a no-op
//   - _migrations table has version 2 entry after migration

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";

import { openStateDb } from "../src/pilot/state/db.js";
import { applyMigrations, MIGRATIONS } from "../src/pilot/state/migrations.js";

// --- Fixtures --------------------------------------------------------------

let opened: ReturnType<typeof openStateDb>;
beforeEach(() => {
  opened = openStateDb(":memory:");
});
afterEach(() => opened.close());

// Helper: get column names for a table
function columnNames(db: Database, table: string): string[] {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return cols.map((c) => c.name);
}

// Helper: get all table names (user tables only, excluding sqlite_*)
function tableNames(db: Database): string[] {
  return (
    db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

// Helper: build a v1-only in-memory DB (no v2 migration applied yet).
// We do this by applying only the v1 migration manually, bypassing
// openStateDb which applies all migrations.
function buildV1Db(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  // Apply only v1 manually
  const v1 = MIGRATIONS.find((m) => m.version === 1)!;
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER NOT NULL PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
  const dbAny = db as unknown as { exec?: (sql: string) => void };
  if (typeof dbAny.exec === "function") {
    dbAny.exec(v1.sql);
  } else {
    // Fallback: split on semicolons
    for (const stmt of v1.sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      db.run(stmt);
    }
  }
  db.run(
    "INSERT INTO _migrations (version, description, applied_at) VALUES (?, ?, ?)",
    [1, v1.description, Date.now()],
  );
  return db;
}

// --- v2 migration schema tests ---------------------------------------------

describe("v2 migration creates workflows table with correct schema", () => {
  test("workflows table exists after migration", () => {
    expect(tableNames(opened.db)).toContain("workflows");
  });

  test("workflows table has expected columns", () => {
    const cols = columnNames(opened.db, "workflows");
    expect(cols).toContain("id");
    expect(cols).toContain("goal");
    expect(cols).toContain("started_at");
    expect(cols).toContain("finished_at");
    expect(cols).toContain("status");
    expect(cols).toContain("current_phase");
  });

  test("workflows.id is the primary key", () => {
    const info = opened.db.query("PRAGMA table_info(workflows)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pk = info.find((c) => c.pk === 1);
    expect(pk?.name).toBe("id");
  });

  test("workflows.status CHECK constraint rejects invalid values", () => {
    expect(() => {
      opened.db.run(
        "INSERT INTO workflows (id, goal, started_at, status) VALUES ('w1','g',1,'invalid-status')",
      );
    }).toThrow(/CHECK|constraint/i);
  });

  test("workflows.status CHECK constraint accepts valid values", () => {
    for (const status of ["pending", "running", "completed", "aborted", "failed"]) {
      const id = `w-${status}`;
      expect(() => {
        opened.db.run(
          "INSERT INTO workflows (id, goal, started_at, status) VALUES (?, 'g', 1, ?)",
          [id, status],
        );
        opened.db.run("DELETE FROM workflows WHERE id=?", [id]);
      }).not.toThrow();
    }
  });
});

describe("v2 migration creates phases table with correct schema", () => {
  test("phases table exists after migration", () => {
    expect(tableNames(opened.db)).toContain("phases");
  });

  test("phases table has expected columns", () => {
    const cols = columnNames(opened.db, "phases");
    expect(cols).toContain("workflow_id");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("started_at");
    expect(cols).toContain("finished_at");
    expect(cols).toContain("artifact_path");
  });

  test("phases has composite PK (workflow_id, name)", () => {
    const info = opened.db.query("PRAGMA table_info(phases)").all() as Array<{
      name: string;
      pk: number;
    }>;
    const pkCols = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    expect(pkCols.map((c) => c.name)).toEqual(["workflow_id", "name"]);
  });

  test("phases.name CHECK constraint rejects invalid phase names", () => {
    opened.db.run(
      "INSERT INTO workflows (id, goal, started_at, status) VALUES ('w1','g',1,'pending')",
    );
    expect(() => {
      opened.db.run(
        "INSERT INTO phases (workflow_id, name, status) VALUES ('w1','invalid-phase','pending')",
      );
    }).toThrow(/CHECK|constraint/i);
  });

  test("phases.name CHECK constraint accepts valid phase names", () => {
    opened.db.run(
      "INSERT INTO workflows (id, goal, started_at, status) VALUES ('w1','g',1,'pending')",
    );
    for (const name of ["scope", "plan", "build", "qa", "followup"]) {
      expect(() => {
        opened.db.run(
          "INSERT INTO phases (workflow_id, name, status) VALUES ('w1', ?, 'pending')",
          [name],
        );
        opened.db.run("DELETE FROM phases WHERE workflow_id='w1' AND name=?", [name]);
      }).not.toThrow();
    }
  });

  test("phases.status CHECK constraint rejects invalid values", () => {
    opened.db.run(
      "INSERT INTO workflows (id, goal, started_at, status) VALUES ('w1','g',1,'pending')",
    );
    expect(() => {
      opened.db.run(
        "INSERT INTO phases (workflow_id, name, status) VALUES ('w1','build','not-a-status')",
      );
    }).toThrow(/CHECK|constraint/i);
  });

  test("phases FK to workflows enforced", () => {
    expect(() => {
      opened.db.run(
        "INSERT INTO phases (workflow_id, name, status) VALUES ('nonexistent','build','pending')",
      );
    }).toThrow(/FOREIGN|constraint/i);
  });

  test("deleting a workflow cascades to its phases", () => {
    opened.db.run(
      "INSERT INTO workflows (id, goal, started_at, status) VALUES ('w1','g',1,'pending')",
    );
    opened.db.run(
      "INSERT INTO phases (workflow_id, name, status) VALUES ('w1','build','pending')",
    );
    opened.db.run("DELETE FROM workflows WHERE id='w1'");
    const count = (
      opened.db.query("SELECT COUNT(*) as n FROM phases WHERE workflow_id='w1'").get() as {
        n: number;
      }
    ).n;
    expect(count).toBe(0);
  });
});

describe("v2 migration creates artifacts table with correct schema", () => {
  test("artifacts table exists after migration", () => {
    expect(tableNames(opened.db)).toContain("artifacts");
  });

  test("artifacts table has expected columns", () => {
    const cols = columnNames(opened.db, "artifacts");
    expect(cols).toContain("id");
    expect(cols).toContain("workflow_id");
    expect(cols).toContain("phase");
    expect(cols).toContain("kind");
    expect(cols).toContain("path");
    expect(cols).toContain("created_at");
    expect(cols).toContain("sha256");
  });

  test("artifacts.id is AUTOINCREMENT (sqlite_sequence present)", () => {
    const seq = opened.db
      .query("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'")
      .get();
    expect(seq).not.toBeNull();
  });

  test("artifacts FK to workflows enforced", () => {
    expect(() => {
      opened.db.run(
        "INSERT INTO artifacts (workflow_id, phase, kind, path, created_at) VALUES ('nonexistent','build','plan-yaml','/p',1)",
      );
    }).toThrow(/FOREIGN|constraint/i);
  });

  test("deleting a workflow cascades to its artifacts", () => {
    opened.db.run(
      "INSERT INTO workflows (id, goal, started_at, status) VALUES ('w1','g',1,'pending')",
    );
    opened.db.run(
      "INSERT INTO artifacts (workflow_id, phase, kind, path, created_at) VALUES ('w1','build','plan-yaml','/p',1)",
    );
    opened.db.run("DELETE FROM workflows WHERE id='w1'");
    const count = (
      opened.db
        .query("SELECT COUNT(*) as n FROM artifacts WHERE workflow_id='w1'")
        .get() as { n: number }
    ).n;
    expect(count).toBe(0);
  });
});

describe("v2 migration adds phase column to events table", () => {
  test("events table has phase column after migration", () => {
    const cols = columnNames(opened.db, "events");
    expect(cols).toContain("phase");
  });

  test("events.phase is nullable TEXT", () => {
    const info = opened.db.query("PRAGMA table_info(events)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const phaseCol = info.find((c) => c.name === "phase");
    expect(phaseCol).toBeDefined();
    expect(phaseCol?.type).toBe("TEXT");
    expect(phaseCol?.notnull).toBe(0); // nullable
  });
});

describe("fresh DB has all six tables after migrations", () => {
  test("all six user tables exist", () => {
    const tables = tableNames(opened.db);
    expect(tables).toContain("runs");
    expect(tables).toContain("tasks");
    expect(tables).toContain("events");
    expect(tables).toContain("workflows");
    expect(tables).toContain("phases");
    expect(tables).toContain("artifacts");
  });

  test("_migrations table has both v1 and v2 entries", () => {
    const versions = (
      opened.db
        .query("SELECT version FROM _migrations ORDER BY version")
        .all() as Array<{ version: number }>
    ).map((r) => r.version);
    expect(versions).toContain(1);
    expect(versions).toContain(2);
  });
});

// --- Backfill tests --------------------------------------------------------

describe("backfill creates workflow row for each existing run", () => {
  test("each run gets a matching workflow row with same id", () => {
    const db = buildV1Db();
    try {
      // Insert two runs into the v1 DB
      db.run(
        "INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES ('r1','/p','slug-one',100,'completed')",
      );
      db.run(
        "INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES ('r2','/p','slug-two',200,'running')",
      );

      // Apply v2 migration
      applyMigrations(db);

      const workflows = db
        .query("SELECT id, goal, current_phase FROM workflows ORDER BY started_at")
        .all() as Array<{ id: string; goal: string; current_phase: string }>;

      expect(workflows.length).toBe(2);
      expect(workflows[0]!.id).toBe("r1");
      expect(workflows[0]!.goal).toBe("slug-one");
      expect(workflows[0]!.current_phase).toBe("build");
      expect(workflows[1]!.id).toBe("r2");
      expect(workflows[1]!.goal).toBe("slug-two");
    } finally {
      db.close();
    }
  });

  test("workflow started_at and finished_at match the run", () => {
    const db = buildV1Db();
    try {
      db.run(
        "INSERT INTO runs (id, plan_path, plan_slug, started_at, finished_at, status) VALUES ('r1','/p','s',100,200,'completed')",
      );
      applyMigrations(db);
      const wf = db
        .query("SELECT started_at, finished_at FROM workflows WHERE id='r1'")
        .get() as { started_at: number; finished_at: number };
      expect(wf.started_at).toBe(100);
      expect(wf.finished_at).toBe(200);
    } finally {
      db.close();
    }
  });
});

describe("backfill creates build phase row for each existing run", () => {
  test("each run gets a phases row with name='build'", () => {
    const db = buildV1Db();
    try {
      db.run(
        "INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES ('r1','/p','s',100,'running')",
      );
      applyMigrations(db);
      const phase = db
        .query("SELECT * FROM phases WHERE workflow_id='r1'")
        .get() as { name: string; status: string };
      expect(phase).not.toBeNull();
      expect(phase.name).toBe("build");
    } finally {
      db.close();
    }
  });
});

describe("backfill mirrors run status to phase status", () => {
  test("all 5 run statuses map correctly to phase statuses", () => {
    const db = buildV1Db();
    try {
      const statuses = ["pending", "running", "completed", "aborted", "failed"] as const;
      for (const status of statuses) {
        db.run(
          "INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES (?, '/p', 's', 1, ?)",
          [`r-${status}`, status],
        );
      }
      applyMigrations(db);

      for (const status of statuses) {
        const phase = db
          .query("SELECT status FROM phases WHERE workflow_id=?")
          .get(`r-${status}`) as { status: string };
        expect(phase.status).toBe(status);

        const wf = db
          .query("SELECT status FROM workflows WHERE id=?")
          .get(`r-${status}`) as { status: string };
        expect(wf.status).toBe(status);
      }
    } finally {
      db.close();
    }
  });
});

describe("backfill sets phase='build' on existing events", () => {
  test("pre-existing events get phase='build' after migration", () => {
    const db = buildV1Db();
    try {
      db.run(
        "INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES ('r1','/p','s',1,'running')",
      );
      // Insert events without phase column (v1 schema)
      db.run(
        "INSERT INTO events (run_id, task_id, ts, kind, payload) VALUES ('r1','T1',10,'a','{}')",
      );
      db.run(
        "INSERT INTO events (run_id, task_id, ts, kind, payload) VALUES ('r1',NULL,20,'b','{}')",
      );

      applyMigrations(db);

      const events = db
        .query("SELECT phase FROM events WHERE run_id='r1' ORDER BY id")
        .all() as Array<{ phase: string }>;
      expect(events.length).toBe(2);
      expect(events[0]!.phase).toBe("build");
      expect(events[1]!.phase).toBe("build");
    } finally {
      db.close();
    }
  });
});

// --- Idempotency -----------------------------------------------------------

describe("v2 migration is idempotent", () => {
  test("running applyMigrations twice on a fresh DB is a no-op", () => {
    // First call already happened in openStateDb
    expect(() => {
      const second = applyMigrations(opened.db);
      expect(second).toEqual([]);
    }).not.toThrow();
  });

  test("no duplicate rows after double migration", () => {
    applyMigrations(opened.db);
    const migrationCount = (
      opened.db
        .query("SELECT COUNT(*) as n FROM _migrations")
        .get() as { n: number }
    ).n;
    // Should have exactly 2 rows (v1 + v2), not 4
    expect(migrationCount).toBe(MIGRATIONS.length);
  });

  test("running v2 on a v1-only DB twice produces no errors and no duplicates", () => {
    const db = buildV1Db();
    try {
      db.run(
        "INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES ('r1','/p','s',1,'running')",
      );
      // First application
      applyMigrations(db);
      const wfCount1 = (
        db.query("SELECT COUNT(*) as n FROM workflows").get() as { n: number }
      ).n;
      expect(wfCount1).toBe(1);

      // Second application — should be a no-op
      const second = applyMigrations(db);
      expect(second).toEqual([]);
      const wfCount2 = (
        db.query("SELECT COUNT(*) as n FROM workflows").get() as { n: number }
      ).n;
      expect(wfCount2).toBe(1); // still 1, not 2
    } finally {
      db.close();
    }
  });
});
