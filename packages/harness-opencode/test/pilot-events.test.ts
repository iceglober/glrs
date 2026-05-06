/**
 * Tests for pilot v2 event logging.
 */

import { describe, test, expect } from "bun:test";
import { openStateDb, createWorkflow, appendEvent, readEvents, logEvent } from "../src/pilot/state.js";

describe("pilot events — events are written to SQLite", () => {
  test("appendEvent writes to the events table", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, {
        workflowId: wfId,
        phase: "execute",
        kind: "task.execute.started",
        payload: { task: "1/3", id: "TASK-001" },
      });
      const rows = readEvents(db, { workflowId: wfId });
      expect(rows.length).toBe(1);
      expect(rows[0]!.kind).toBe("task.execute.started");
    } finally {
      close();
    }
  });
});

describe("pilot events — events include phase and session_id", () => {
  test("events have phase field", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, {
        workflowId: wfId,
        phase: "assess",
        kind: "task.assess.started",
        payload: {},
        sessionId: "ses_abc123",
      });
      const rows = readEvents(db, { workflowId: wfId });
      expect(rows[0]!.phase).toBe("assess");
      expect(rows[0]!.session_id).toBe("ses_abc123");
    } finally {
      close();
    }
  });

  test("events can be filtered by phase", () => {
    const { db, close } = openStateDb(":memory:");
    try {
      const wfId = createWorkflow(db, { goal: "test" });
      appendEvent(db, { workflowId: wfId, phase: "plan", kind: "task.plan.started", payload: {} });
      appendEvent(db, { workflowId: wfId, phase: "execute", kind: "task.execute.started", payload: {} });
      appendEvent(db, { workflowId: wfId, phase: "assess", kind: "task.assess.started", payload: {} });

      const planEvents = readEvents(db, { workflowId: wfId, phase: "plan" });
      expect(planEvents.length).toBe(1);
      expect(planEvents[0]!.phase).toBe("plan");
    } finally {
      close();
    }
  });
});

describe("pilot events — stderr output matches structured format", () => {
  test("logEvent writes to stderr with [pilot] prefix", () => {
    const { db, close } = openStateDb(":memory:");
    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrLines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    try {
      const wfId = createWorkflow(db, { goal: "test" });
      logEvent(db, {
        workflowId: wfId,
        phase: "execute",
        kind: "task.execute.started",
        payload: { task: "1/3", id: "TASK-001" },
      });

      const output = stderrLines.join("");
      expect(output).toContain("[pilot]");
      expect(output).toContain("task.execute.started");
      expect(output).toContain("task=1/3");
    } finally {
      process.stderr.write = origWrite;
      close();
    }
  });

  test("logEvent also writes to SQLite", () => {
    const { db, close } = openStateDb(":memory:");
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;

    try {
      const wfId = createWorkflow(db, { goal: "test" });
      logEvent(db, {
        workflowId: wfId,
        phase: "plan",
        kind: "task.plan.completed",
        payload: { tasks: 4 },
      });

      const rows = readEvents(db, { workflowId: wfId });
      expect(rows.length).toBe(1);
      expect(rows[0]!.kind).toBe("task.plan.completed");
    } finally {
      process.stderr.write = origWrite;
      close();
    }
  });
});
