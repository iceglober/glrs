// pilot-worker-status-integration.test.ts — end-to-end flow test for
// the status update feature: registry write → event written → streaming
// logger formats → registry cleaned up.
//
// This test does NOT spawn a real opencode server or MCP subprocess.
// Instead it tests the worker-side integration: registry lifecycle and
// streaming logger rendering of task.progress events.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import {
  registerSession,
  unregisterSession,
  readSessions,
} from "../src/pilot/mcp/session-registry.js";
import { appendEvent, subscribeToEvents } from "../src/pilot/state/events.js";
import { startStreamingLogger } from "../src/pilot/cli/build.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-status-integration-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createStateDb(dbFile: string): Database {
  const db = new Database(dbFile);
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      task_id TEXT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);
  return db;
}

describe("status update integration", () => {
  test("progress event flows from MCP call to streaming log and registry is cleaned up", async () => {
    const runId = "run-integration-1";
    const taskId = "T1-SETUP";
    const sessionId = "sess-integration-abc";
    const runDir = path.join(tmpDir, "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });

    const dbPath = path.join(runDir, "state.db");
    const db = createStateDb(dbPath);

    // Step 1: Register session (simulates worker's registerSession call)
    await registerSession({
      runDir,
      sessionId,
      runId,
      taskId,
    });

    // Verify registry was written
    const sessions = readSessions(runDir);
    expect(sessions[sessionId]).toEqual({ runId, taskId });

    // Step 2: Start the streaming logger BEFORE writing the progress event
    // (simulates real flow: logger starts at run begin, MCP writes during execution)
    const logLines: string[] = [];
    const stderrWriter = (chunk: string) => logLines.push(chunk);

    const unsubLogger = startStreamingLogger({
      stderrWriter,
      runId,
      totalTasks: 1,
      subscribe: subscribeToEvents,
      db: db,
      progressPollMs: 50, // Fast polling for test
    });

    // Step 3: Simulate MCP server writing a task.progress event directly to DB
    // (This is what the MCP subprocess does via raw SQL)
    const progressTs = Date.now();
    db.run(
      `INSERT INTO events (run_id, task_id, ts, kind, payload) VALUES (?, ?, ?, ?, ?)`,
      [runId, taskId, progressTs, "task.progress", JSON.stringify({ message: "writing tests", sessionId })],
    );

    // Wait for the poller to pick up the event
    await new Promise((r) => setTimeout(r, 150));

    // The poller should have rendered the progress line
    const progressLine = logLines.find((l) => l.includes("writing tests"));
    expect(progressLine).toBeDefined();
    expect(progressLine).toContain(`${taskId} > writing tests`);

    // Step 4: Verify in-process appendEvent fan-out still works for other events
    logLines.length = 0;
    appendEvent(db, {
      runId,
      taskId,
      kind: "task.verify.passed",
      payload: { attempt: 1 },
    });

    // In-process fan-out is synchronous
    const verifyLine = logLines.find((l) => l.includes("task.verify.passed"));
    expect(verifyLine).toBeDefined();

    // Step 5: Unregister session (simulates worker cleanup)
    await unregisterSession({ runDir, sessionId });

    const sessionsAfter = readSessions(runDir);
    expect(sessionsAfter[sessionId]).toBeUndefined();
    expect(Object.keys(sessionsAfter)).toHaveLength(0);

    // Cleanup
    unsubLogger();
    db.close();
  });

  test("no orphaned registry entries after task lifecycle", async () => {
    const runId = "run-lifecycle-1";
    const runDir = path.join(tmpDir, "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });

    // Register multiple sessions
    const sessions = ["sess-1", "sess-2", "sess-3"];
    for (const sid of sessions) {
      await registerSession({
        runDir,
        sessionId: sid,
        runId,
        taskId: `task-for-${sid}`,
      });
    }

    // Verify all registered
    const before = readSessions(runDir);
    expect(Object.keys(before)).toHaveLength(3);

    // Unregister all (simulates worker cleanup on task completion)
    for (const sid of sessions) {
      await unregisterSession({ runDir, sessionId: sid });
    }

    // Verify all cleaned up
    const after = readSessions(runDir);
    expect(Object.keys(after)).toHaveLength(0);
  });

  test("streaming logger ignores task.progress from other runs", async () => {
    const runId = "run-target";
    const otherRunId = "run-other";
    const runDir = path.join(tmpDir, "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });

    const dbPath = path.join(runDir, "state.db");
    const db = createStateDb(dbPath);

    // Write a progress event for a DIFFERENT run
    db.run(
      `INSERT INTO events (run_id, task_id, ts, kind, payload) VALUES (?, ?, ?, ?, ?)`,
      [otherRunId, "T1-OTHER", Date.now(), "task.progress", JSON.stringify({ message: "other run progress" })],
    );

    const logLines: string[] = [];
    const unsubLogger = startStreamingLogger({
      stderrWriter: (chunk: string) => logLines.push(chunk),
      runId,
      totalTasks: 1,
      subscribe: subscribeToEvents,
      db: db,
      progressPollMs: 50,
    });

    await new Promise((r) => setTimeout(r, 150));

    // Should NOT have rendered the other run's progress
    const progressLine = logLines.find((l) => l.includes("other run progress"));
    expect(progressLine).toBeUndefined();

    unsubLogger();
    db.close();
  });
});
