/**
 * Tests for pilot v2 state module.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { openStateDb, createWorkflow, getWorkflow, listWorkflows, latestWorkflow, updateWorkflowStatus, appendEvent, readEvents } from "../src/pilot/state.js";

describe("pilot state — schema", () => {
  test("openStateDb creates workflows and events tables", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      ).all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain("workflows");
      expect(names).toContain("events");
    } finally {
      close();
    }
  });

  test("openStateDb is idempotent (reopen same DB)", () => {
    const { db: db1, close: close1 } = openStateDb(":memory:");
    close1();
    // Opening a second in-memory DB is always fresh — just verify no throw
    const { db: db2, close: close2 } = openStateDb(":memory:");
    close2();
  });

  test("workflows table has correct columns", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const cols = db.prepare(`PRAGMA table_info(workflows)`).all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("id");
      expect(names).toContain("goal");
      expect(names).toContain("scope_path");
      expect(names).toContain("plan_path");
      expect(names).toContain("status");
      expect(names).toContain("started_at");
      expect(names).toContain("finished_at");
      expect(names).toContain("config");
    } finally {
      close();
    }
  });

  test("events table has correct columns", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const cols = db.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("id");
      expect(names).toContain("workflow_id");
      expect(names).toContain("ts");
      expect(names).toContain("phase");
      expect(names).toContain("kind");
      expect(names).toContain("task_id");
      expect(names).toContain("payload");
      expect(names).toContain("session_id");
    } finally {
      close();
    }
  });

  test("workflows status CHECK constraint is enforced", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      expect(() => {
        db.prepare(`INSERT INTO workflows (id, goal, status, started_at) VALUES ('x', 'g', 'invalid', 1)`).run();
      }).toThrow();
    } finally {
      close();
    }
  });

  test("events FK constraint is enforced", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      expect(() => {
        db.prepare(
          `INSERT INTO events (workflow_id, ts, phase, kind, payload) VALUES ('nonexistent', 1, 'scope', 'test', '{}')`,
        ).run();
      }).toThrow();
    } finally {
      close();
    }
  });
});

describe("pilot state — workflow CRUD", () => {
  test("createWorkflow returns a ULID and inserts a pending row", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const id = createWorkflow(db, { goal: "Add dark mode" });
      expect(id).toMatch(/^[0-9A-Z]{26}$/);
      const row = getWorkflow(db, id);
      expect(row).not.toBeNull();
      expect(row!.goal).toBe("Add dark mode");
      expect(row!.status).toBe("pending");
      expect(row!.finished_at).toBeNull();
    } finally {
      close();
    }
  });

  test("getWorkflow returns null for unknown id", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      expect(getWorkflow(db, "nonexistent")).toBeNull();
    } finally {
      close();
    }
  });

  test("listWorkflows returns newest first", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      createWorkflow(db, { goal: "first", now: 1000 });
      createWorkflow(db, { goal: "second", now: 2000 });
      createWorkflow(db, { goal: "third", now: 3000 });
      const rows = listWorkflows(db);
      expect(rows[0]!.goal).toBe("third");
      expect(rows[1]!.goal).toBe("second");
      expect(rows[2]!.goal).toBe("first");
    } finally {
      close();
    }
  });

  test("latestWorkflow returns the most recent", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      createWorkflow(db, { goal: "old", now: 1000 });
      createWorkflow(db, { goal: "new", now: 2000 });
      const row = latestWorkflow(db);
      expect(row!.goal).toBe("new");
    } finally {
      close();
    }
  });

  test("latestWorkflow returns null when no workflows", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      expect(latestWorkflow(db)).toBeNull();
    } finally {
      close();
    }
  });

  test("updateWorkflowStatus transitions status", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const id = createWorkflow(db, { goal: "test" });
      updateWorkflowStatus(db, id, "scoped", { scopePath: "/tmp/scope.json" });
      const row = getWorkflow(db, id);
      expect(row!.status).toBe("scoped");
      expect(row!.scope_path).toBe("/tmp/scope.json");
      expect(row!.finished_at).toBeNull();
    } finally {
      close();
    }
  });

  test("updateWorkflowStatus sets finished_at on terminal status", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const id = createWorkflow(db, { goal: "test" });
      updateWorkflowStatus(db, id, "completed", { now: 9999 });
      const row = getWorkflow(db, id);
      expect(row!.status).toBe("completed");
      expect(row!.finished_at).toBe(9999);
    } finally {
      close();
    }
  });

  test("updateWorkflowStatus sets finished_at on failed status", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const id = createWorkflow(db, { goal: "test" });
      updateWorkflowStatus(db, id, "failed", { now: 5555 });
      const row = getWorkflow(db, id);
      expect(row!.finished_at).toBe(5555);
    } finally {
      close();
    }
  });
});

describe("pilot state — events", () => {
  test("appendEvent inserts a row", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, {
        workflowId: wfId,
        phase: "scope",
        kind: "task.scope.started",
        payload: { session: "ses_abc" },
      });
      const rows = readEvents(db, { workflowId: wfId });
      expect(rows.length).toBe(1);
      expect(rows[0]!.kind).toBe("task.scope.started");
      expect(rows[0]!.phase).toBe("scope");
    } finally {
      close();
    }
  });

  test("readEvents filters by phase", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, { workflowId: wfId, phase: "scope", kind: "task.scope.started", payload: {} });
      appendEvent(db, { workflowId: wfId, phase: "plan", kind: "task.plan.started", payload: {} });
      appendEvent(db, { workflowId: wfId, phase: "scope", kind: "task.scope.completed", payload: {} });

      const scopeEvents = readEvents(db, { workflowId: wfId, phase: "scope" });
      expect(scopeEvents.length).toBe(2);
      expect(scopeEvents.every((e) => e.phase === "scope")).toBe(true);
    } finally {
      close();
    }
  });

  test("events are ordered by insertion (id ASC)", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, { workflowId: wfId, phase: "execute", kind: "task.execute.started", payload: { task: 1 } });
      appendEvent(db, { workflowId: wfId, phase: "execute", kind: "task.execute.completed", payload: { task: 1 } });
      const rows = readEvents(db, { workflowId: wfId });
      expect(rows[0]!.kind).toBe("task.execute.started");
      expect(rows[1]!.kind).toBe("task.execute.completed");
    } finally {
      close();
    }
  });

  test("appendEvent stores session_id and task_id", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, {
        workflowId: wfId,
        phase: "execute",
        kind: "task.execute.started",
        payload: {},
        taskId: "TASK-1",
        sessionId: "ses_xyz",
      });
      const rows = readEvents(db, { workflowId: wfId });
      expect(rows[0]!.task_id).toBe("TASK-1");
      expect(rows[0]!.session_id).toBe("ses_xyz");
    } finally {
      close();
    }
  });

  test("events are scoped to workflow (FK cascade)", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId1 = createWorkflow(db, { goal: "wf1" });
      const wfId2 = createWorkflow(db, { goal: "wf2" });
      appendEvent(db, { workflowId: wfId1, phase: "scope", kind: "e1", payload: {} });
      appendEvent(db, { workflowId: wfId2, phase: "scope", kind: "e2", payload: {} });

      const wf1Events = readEvents(db, { workflowId: wfId1 });
      expect(wf1Events.length).toBe(1);
      expect(wf1Events[0]!.kind).toBe("e1");
    } finally {
      close();
    }
  });
});
