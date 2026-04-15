import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initState, cleanupState, createEpic, createTask, transitionTask, setPlansDir } from "../lib/state.js";
import { compactSummary } from "./status.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-status-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DIR, "state.db");

beforeEach(async () => {
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  await initState(TEST_DB_PATH);
  setPlansDir(path.join(TEST_DIR, "plans"));
});

afterEach(() => {
  setPlansDir(null);
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe("compactSummary", () => {
  test("returns 'No epics' when DB is empty", () => {
    expect(compactSummary()).toBe("No epics");
  });

  test("single epic with mixed progress", () => {
    const epic = createEpic({ title: "Test Epic" });
    createTask({ title: "Done task", epic: epic.id, phase: "done" });
    createTask({ title: "Active task", epic: epic.id, phase: "implement" });
    createTask({ title: "Ready task", epic: epic.id, phase: "design" });

    const result = compactSummary();
    expect(result).toContain(epic.id);
    expect(result).toContain("Test Epic");
    expect(result).toContain("1/3 done");
  });

  test("all tasks done shows only done count", () => {
    const epic = createEpic({ title: "Complete" });
    createTask({ title: "T1", epic: epic.id, phase: "done" });
    createTask({ title: "T2", epic: epic.id, phase: "done" });

    const result = compactSummary();
    expect(result).toContain("2/2 done");
    expect(result).not.toContain("ready");
    expect(result).not.toContain("blocked");
  });

  test("epic filter shows only matching epic", () => {
    const e1 = createEpic({ title: "First" });
    const e2 = createEpic({ title: "Second" });
    createTask({ title: "T1", epic: e1.id });
    createTask({ title: "T2", epic: e2.id });

    const result = compactSummary(e1.id);
    expect(result).toContain("First");
    expect(result).not.toContain("Second");
  });

  test("multiple epics joined by pipe separator", () => {
    const e1 = createEpic({ title: "Alpha" });
    const e2 = createEpic({ title: "Beta" });
    createTask({ title: "T1", epic: e1.id });
    createTask({ title: "T2", epic: e2.id });

    const result = compactSummary();
    expect(result).toContain(" | ");
    expect(result).toContain("Alpha");
    expect(result).toContain("Beta");
  });
});
