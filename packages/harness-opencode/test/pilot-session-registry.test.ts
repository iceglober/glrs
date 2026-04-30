// pilot-session-registry.test.ts — registry I/O tests for
// src/pilot/mcp/session-registry.ts

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  registerSession,
  unregisterSession,
  readSessions,
  getSessionsPath,
  cleanupTempFiles,
  type SessionEntry,
} from "../src/pilot/mcp/session-registry.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-session-registry-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getSessionsPath", () => {
  test("returns sessions.json under runDir", () => {
    const runDir = "/some/path/run-123";
    const result = getSessionsPath(runDir);
    expect(result).toBe("/some/path/run-123/sessions.json");
  });
});

describe("readSessions", () => {
  test("returns empty object when file does not exist", () => {
    const result = readSessions(tmpDir);
    expect(result).toEqual({});
  });

  test("returns empty object when file is malformed JSON", () => {
    const sessionsPath = path.join(tmpDir, "sessions.json");
    fs.writeFileSync(sessionsPath, "not valid json");
    const result = readSessions(tmpDir);
    expect(result).toEqual({});
  });

  test("returns empty object when file contains non-object", () => {
    const sessionsPath = path.join(tmpDir, "sessions.json");
    fs.writeFileSync(sessionsPath, "123");
    const result = readSessions(tmpDir);
    expect(result).toEqual({});
  });

  test("returns parsed sessions when file exists", () => {
    const sessionsPath = path.join(tmpDir, "sessions.json");
    const data = {
      session1: { runId: "run1", taskId: "task1" },
      session2: { runId: "run1", taskId: "task2" },
    };
    fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
    const result = readSessions(tmpDir);
    expect(result).toEqual(data);
  });
});

describe("registerSession", () => {
  test("creates sessions.json with single entry", async () => {
    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-123",
      runId: "run-abc",
      taskId: "task-xyz",
      
    });

    const sessions = readSessions(tmpDir);
    expect(sessions).toEqual({
      "sess-123": { runId: "run-abc", taskId: "task-xyz" },
    });
  });

  test("appends to existing sessions", async () => {
    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-1",
      runId: "run-a",
      taskId: "task-1",
      
    });

    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-2",
      runId: "run-a",
      taskId: "task-2",
      
    });

    const sessions = readSessions(tmpDir);
    expect(Object.keys(sessions)).toHaveLength(2);
    expect(sessions["sess-1"]).toEqual({ runId: "run-a", taskId: "task-1" });
    expect(sessions["sess-2"]).toEqual({ runId: "run-a", taskId: "task-2" });
  });

  test("overwrites existing session with same ID", async () => {
    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-1",
      runId: "run-a",
      taskId: "task-1",
      
    });

    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-1",
      runId: "run-b",
      taskId: "task-2",
      
    });

    const sessions = readSessions(tmpDir);
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(sessions["sess-1"]).toEqual({ runId: "run-b", taskId: "task-2" });
  });

  test("creates parent directories if needed", async () => {
    const nestedDir = path.join(tmpDir, "nested", "deep", "run");
    
    await registerSession({
      runDir: nestedDir,
      sessionId: "sess-1",
      runId: "run-a",
      taskId: "task-1",
      
    });

    expect(fs.existsSync(nestedDir)).toBe(true);
    const sessions = readSessions(nestedDir);
    expect(sessions["sess-1"]).toBeDefined();
  });
});

describe("unregisterSession", () => {
  test("removes session from registry", async () => {
    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-1",
      runId: "run-a",
      taskId: "task-1",
      
    });

    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-2",
      runId: "run-a",
      taskId: "task-2",
      
    });

    await unregisterSession({ runDir: tmpDir, sessionId: "sess-1" });

    const sessions = readSessions(tmpDir);
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(sessions["sess-1"]).toBeUndefined();
    expect(sessions["sess-2"]).toBeDefined();
  });

  test("is no-op when session does not exist", async () => {
    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-1",
      runId: "run-a",
      taskId: "task-1",
      
    });

    await unregisterSession({ runDir: tmpDir, sessionId: "nonexistent" });

    const sessions = readSessions(tmpDir);
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(sessions["sess-1"]).toBeDefined();
  });

  test("is no-op when registry does not exist", async () => {
    await expect(
      unregisterSession({ runDir: tmpDir, sessionId: "sess-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("cleanupTempFiles", () => {
  test("removes orphaned temp files", async () => {
    const sessionsPath = path.join(tmpDir, "sessions.json");
    const temp1 = `${sessionsPath}.tmp.12345`;
    const temp2 = `${sessionsPath}.tmp.67890`;
    
    fs.writeFileSync(temp1, "temp data");
    fs.writeFileSync(temp2, "temp data");
    fs.writeFileSync(sessionsPath, "{}");

    await cleanupTempFiles(tmpDir);

    expect(fs.existsSync(temp1)).toBe(false);
    expect(fs.existsSync(temp2)).toBe(false);
    expect(fs.existsSync(sessionsPath)).toBe(true);
  });

  test("is no-op when directory does not exist", async () => {
    await expect(cleanupTempFiles("/nonexistent/path")).resolves.toBeUndefined();
  });

  test("ignores non-temp files", async () => {
    const sessionsPath = path.join(tmpDir, "sessions.json");
    const otherFile = path.join(tmpDir, "other.txt");
    
    fs.writeFileSync(sessionsPath, "{}");
    fs.writeFileSync(otherFile, "data");

    await cleanupTempFiles(tmpDir);

    expect(fs.existsSync(otherFile)).toBe(true);
    expect(fs.existsSync(sessionsPath)).toBe(true);
  });
});

describe("concurrent writes", () => {
  test("handles sequential register calls deterministically", async () => {
    // Sequential registration to test that multiple registrations work correctly
    for (let i = 0; i < 5; i++) {
      await registerSession({
        runDir: tmpDir,
        sessionId: `sess-${i}`,
        runId: "run-a",
        taskId: `task-${i}`,
      });
    }

    const sessions = readSessions(tmpDir);
    expect(Object.keys(sessions)).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      expect(sessions[`sess-${i}`]).toEqual({
        runId: "run-a",
        taskId: `task-${i}`,
      });
    }
  });

  test("handles interleaved register and unregister", async () => {
    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-1",
      runId: "run-a",
      taskId: "task-1",
    });

    await unregisterSession({ runDir: tmpDir, sessionId: "sess-1" });

    await registerSession({
      runDir: tmpDir,
      sessionId: "sess-2",
      runId: "run-a",
      taskId: "task-2",
    });

    const sessions = readSessions(tmpDir);
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(sessions["sess-2"]).toBeDefined();
    expect(sessions["sess-1"]).toBeUndefined();
  });

  test("concurrent register/unregister on same file preserves invariant", async () => {
    // This test exercises the race condition: two overlapping registerSession
    // calls both read the same snapshot, and the second rename could drop the
    // first's entry. In v0.1 (single-worker), this race is latent because
    // tasks are sequential. This test documents the known limitation and
    // verifies that at minimum no crash occurs and the file remains valid JSON.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        registerSession({
          runDir: tmpDir,
          sessionId: `concurrent-sess-${i}`,
          runId: "run-a",
          taskId: `task-${i}`,
        }),
      );
    }
    // All promises resolve without throwing (no ENOENT, no corrupt JSON).
    await Promise.all(promises);

    // The file must be valid JSON regardless of race outcome.
    const sessions = readSessions(tmpDir);
    expect(typeof sessions).toBe("object");
    expect(sessions).not.toBeNull();

    // At minimum, the LAST writer's entry survives. Due to the read-spread-
    // rename race, we may not have all 10 — but we must have at least 1.
    const keys = Object.keys(sessions);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.length).toBeLessThanOrEqual(10);

    // Every surviving entry must have the correct shape.
    for (const key of keys) {
      expect(sessions[key]).toHaveProperty("runId", "run-a");
      expect(sessions[key]).toHaveProperty("taskId");
    }
  });
});
