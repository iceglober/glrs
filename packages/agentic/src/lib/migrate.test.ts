import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, persistDb, closeDb, resetDb } from "./db.js";
import { migrateJsonToSqlite, type MigrationResult } from "./migrate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEST_DIR = path.join(os.tmpdir(), "glorious-migrate-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DIR, "state.db");
const TEST_STATE_DIR = path.join(TEST_DIR, "repo", ".glorious", "state");

function writeStateFile(id: string, data: Record<string, unknown>): void {
  fs.writeFileSync(path.join(TEST_STATE_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

function writePipelineFile(id: string, data: Record<string, unknown>): void {
  fs.writeFileSync(path.join(TEST_STATE_DIR, `${id}.pipeline.json`), JSON.stringify(data, null, 2));
}

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    title: "Test task",
    description: "A test task",
    phase: "implement",
    parent: null,
    children: [],
    dependencies: [],
    branch: "feat/test",
    worktree: "/tmp/worktree",
    pr: "https://github.com/test/repo/pull/1",
    externalId: "EXT-123",
    spec: ".glorious/specs/t1.md",
    qaResult: null,
    transitions: [
      { phase: "understand", timestamp: "2026-01-01T00:00:00.000Z", actor: "cli" },
      { phase: "implement", timestamp: "2026-01-02T00:00:00.000Z", actor: "build-loop" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("migrateJsonToSqlite", () => {
  beforeEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  test("migrates parent task as epic", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Parent epic",
      description: "Epic description",
      phase: "design",
      children: ["t1-1"],
      branch: "feat/epic",
      spec: ".glorious/specs/t1.md",
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "Child task",
      parent: "t1",
      children: [],
      phase: "implement",
    }));

    const db = await getDb(TEST_DB_PATH);
    const result = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const epics = db.exec("SELECT id, title, description, phase, spec FROM epics WHERE repo = 'test/repo'");
    expect(epics[0]?.values.length).toBe(1);
    expect(epics[0].values[0][0]).toBe("e1"); // t1 → e1
    expect(epics[0].values[0][1]).toBe("Parent epic");
    expect(epics[0].values[0][2]).toBe("Epic description");
    expect(epics[0].values[0][3]).toBe("design");
    expect(epics[0].values[0][4]).toBe(".glorious/specs/t1.md");
  });

  test("migrates workstreams as tasks with epic FK", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Parent",
      children: ["t1-1", "t1-2"],
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "First workstream",
      parent: "t1",
      children: [],
      phase: "done",
      branch: "feat/ws1",
    }));
    writeStateFile("t1-2", makeTask({
      id: "t1-2",
      title: "Second workstream",
      parent: "t1",
      children: [],
      phase: "implement",
      branch: "feat/ws2",
      dependencies: ["t1-1"],
    }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const tasks = db.exec("SELECT id, epic, title, phase, branch, dependencies FROM tasks WHERE repo = 'test/repo' ORDER BY id");
    expect(tasks[0]?.values.length).toBe(2);

    // t1-1 → t1 with epic=e1
    expect(tasks[0].values[0][0]).toBe("t1");
    expect(tasks[0].values[0][1]).toBe("e1");
    expect(tasks[0].values[0][2]).toBe("First workstream");
    expect(tasks[0].values[0][3]).toBe("done");
    expect(tasks[0].values[0][4]).toBe("feat/ws1");

    // t1-2 → t2 with epic=e1, dependencies remapped
    expect(tasks[0].values[1][0]).toBe("t2");
    expect(tasks[0].values[1][1]).toBe("e1");
    expect(tasks[0].values[1][2]).toBe("Second workstream");
    expect(tasks[0].values[1][3]).toBe("implement");
    expect(tasks[0].values[1][4]).toBe("feat/ws2");
    // Dependencies should be remapped: t1-1 → t1
    const deps = JSON.parse(tasks[0].values[1][5] as string);
    expect(deps).toEqual(["t1"]);
  });

  test("migrates standalone task with epic=null", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Standalone",
      parent: null,
      children: [],
      phase: "verify",
      branch: "feat/standalone",
    }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    // No epics created
    const epics = db.exec("SELECT COUNT(*) FROM epics WHERE repo = 'test/repo'");
    expect(epics[0]?.values[0]?.[0]).toBe(0);

    // Task exists with epic=null
    const tasks = db.exec("SELECT id, epic, title, phase FROM tasks WHERE repo = 'test/repo'");
    expect(tasks[0]?.values.length).toBe(1);
    expect(tasks[0].values[0][0]).toBe("t1");
    expect(tasks[0].values[0][1]).toBe(null);
    expect(tasks[0].values[0][2]).toBe("Standalone");
    expect(tasks[0].values[0][3]).toBe("verify");
  });

  test("preserves all task fields", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Full task",
      description: "Detailed description",
      phase: "implement",
      parent: null,
      children: [],
      dependencies: [],
      branch: "feat/full",
      worktree: "/tmp/wt",
      pr: "https://github.com/test/repo/pull/42",
      externalId: "JIRA-123",
      spec: ".glorious/specs/t1.md",
      qaResult: { status: "pass", summary: "All tests pass", timestamp: "2026-01-03T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
    }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const tasks = db.exec(
      "SELECT id, title, description, phase, branch, worktree, pr, external_id, spec, qa_status, qa_summary, qa_timestamp, created_at FROM tasks WHERE repo = 'test/repo'"
    );
    const row = tasks[0]?.values[0];
    expect(row).toBeTruthy();
    expect(row![0]).toBe("t1"); // id
    expect(row![1]).toBe("Full task"); // title
    expect(row![2]).toBe("Detailed description"); // description
    expect(row![3]).toBe("implement"); // phase
    expect(row![4]).toBe("feat/full"); // branch
    expect(row![5]).toBe("/tmp/wt"); // worktree
    expect(row![6]).toBe("https://github.com/test/repo/pull/42"); // pr
    expect(row![7]).toBe("JIRA-123"); // external_id
    expect(row![8]).toBe(".glorious/specs/t1.md"); // spec
    expect(row![9]).toBe("pass"); // qa_status
    expect(row![10]).toBe("All tests pass"); // qa_summary
    expect(row![11]).toBe("2026-01-03T00:00:00.000Z"); // qa_timestamp
    expect(row![12]).toBe("2026-01-01T00:00:00.000Z"); // created_at
  });

  test("migrates transitions into transitions table", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "With transitions",
      parent: null,
      children: [],
      transitions: [
        { phase: "understand", timestamp: "2026-01-01T00:00:00.000Z", actor: "cli" },
        { phase: "design", timestamp: "2026-01-02T00:00:00.000Z", actor: "cli" },
        { phase: "implement", timestamp: "2026-01-03T00:00:00.000Z", actor: "build-loop" },
      ],
    }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const transitions = db.exec(
      "SELECT task_id, entity, phase, actor, timestamp FROM transitions WHERE repo = 'test/repo' ORDER BY timestamp"
    );
    expect(transitions[0]?.values.length).toBe(3);
    // task_id should be remapped: t1 stays t1 (standalone)
    expect(transitions[0].values[0][0]).toBe("t1");
    expect(transitions[0].values[0][1]).toBe("task");
    expect(transitions[0].values[0][2]).toBe("understand");
    expect(transitions[0].values[0][3]).toBe("cli");
    expect(transitions[0].values[1][2]).toBe("design");
    expect(transitions[0].values[2][2]).toBe("implement");
    expect(transitions[0].values[2][3]).toBe("build-loop");
  });

  test("migrates epic transitions with entity=epic", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Parent",
      children: ["t1-1"],
      transitions: [
        { phase: "design", timestamp: "2026-01-01T00:00:00.000Z", actor: "cli" },
      ],
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "Child",
      parent: "t1",
      children: [],
      transitions: [
        { phase: "implement", timestamp: "2026-01-02T00:00:00.000Z", actor: "cli" },
      ],
    }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    // Epic transitions
    const epicTransitions = db.exec(
      "SELECT task_id, entity, phase FROM transitions WHERE repo = 'test/repo' AND entity = 'epic'"
    );
    expect(epicTransitions[0]?.values.length).toBe(1);
    expect(epicTransitions[0].values[0][0]).toBe("e1");
    expect(epicTransitions[0].values[0][2]).toBe("design");

    // Task transitions
    const taskTransitions = db.exec(
      "SELECT task_id, entity, phase FROM transitions WHERE repo = 'test/repo' AND entity = 'task'"
    );
    expect(taskTransitions[0]?.values.length).toBe(1);
    expect(taskTransitions[0].values[0][0]).toBe("t1");
    expect(taskTransitions[0].values[0][2]).toBe("implement");
  });

  test("migrates pipeline state files", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Standalone with pipeline",
      parent: null,
      children: [],
    }));
    writePipelineFile("t1", {
      taskId: "t1",
      currentPhase: "implement",
      completedSkills: ["think", "work"],
      skippedSkills: ["qa"],
      nextSkill: "ship",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const pipelines = db.exec(
      "SELECT task_id, current_phase, completed_skills, skipped_skills, next_skill, started_at FROM pipelines WHERE repo = 'test/repo'"
    );
    expect(pipelines[0]?.values.length).toBe(1);
    expect(pipelines[0].values[0][0]).toBe("t1"); // task_id
    expect(pipelines[0].values[0][1]).toBe("implement"); // current_phase
    expect(JSON.parse(pipelines[0].values[0][2] as string)).toEqual(["think", "work"]);
    expect(JSON.parse(pipelines[0].values[0][3] as string)).toEqual(["qa"]);
    expect(pipelines[0].values[0][4]).toBe("ship");
    expect(pipelines[0].values[0][5]).toBe("2026-01-01T00:00:00.000Z");
  });

  test("pipeline task IDs are remapped for workstreams", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Parent",
      children: ["t1-1"],
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "Workstream",
      parent: "t1",
      children: [],
    }));
    writePipelineFile("t1-1", {
      taskId: "t1-1",
      currentPhase: "implement",
      completedSkills: [],
      skippedSkills: [],
      nextSkill: null,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const pipelines = db.exec("SELECT task_id FROM pipelines WHERE repo = 'test/repo'");
    expect(pipelines[0]?.values[0]?.[0]).toBe("t1"); // t1-1 → t1
  });

  test("records migration in migrations table", async () => {
    writeStateFile("t1", makeTask({ id: "t1", children: [] }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const migrations = db.exec("SELECT repo, file_count FROM migrations WHERE repo = 'test/repo'");
    expect(migrations[0]?.values.length).toBe(1);
    expect(migrations[0].values[0][0]).toBe("test/repo");
    expect(migrations[0].values[0][1]).toBe(1); // 1 task file
  });

  test("skips if already migrated (idempotent)", async () => {
    writeStateFile("t1", makeTask({ id: "t1", title: "Original", children: [] }));

    const db = await getDb(TEST_DB_PATH);
    const result1 = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);
    expect(result1.migrated).toBe(true);

    // Modify the file — should NOT be picked up
    writeStateFile("t1", makeTask({ id: "t1", title: "Modified", children: [] }));
    const result2 = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);
    expect(result2.migrated).toBe(false);
    expect(result2.reason).toBe("already_migrated");

    // Data unchanged
    const tasks = db.exec("SELECT title FROM tasks WHERE repo = 'test/repo'");
    expect(tasks[0]?.values[0]?.[0]).toBe("Original");
  });

  test("returns mapping of old to new IDs", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Parent",
      children: ["t1-1", "t1-2"],
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "WS 1",
      parent: "t1",
      children: [],
    }));
    writeStateFile("t1-2", makeTask({
      id: "t1-2",
      title: "WS 2",
      parent: "t1",
      children: [],
    }));

    const db = await getDb(TEST_DB_PATH);
    const result = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    expect(result.migrated).toBe(true);
    expect(result.idMapping).toBeTruthy();
    expect(result.idMapping!["t1"]).toBe("e1");
    expect(result.idMapping!["t1-1"]).toBe("t1");
    expect(result.idMapping!["t1-2"]).toBe("t2");
  });

  test("handles empty state directory", async () => {
    // TEST_STATE_DIR exists but is empty
    const db = await getDb(TEST_DB_PATH);
    const result = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    expect(result.migrated).toBe(true);
    expect(result.epicCount).toBe(0);
    expect(result.taskCount).toBe(0);
  });

  test("handles missing state directory", async () => {
    const db = await getDb(TEST_DB_PATH);
    const result = await migrateJsonToSqlite(db, "test/repo", "/nonexistent/path");

    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no_state_dir");
  });

  test("handles multiple parent tasks (multiple epics)", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Epic 1",
      children: ["t1-1"],
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "WS under e1",
      parent: "t1",
      children: [],
    }));
    writeStateFile("t2", makeTask({
      id: "t2",
      title: "Epic 2",
      children: ["t2-1"],
    }));
    writeStateFile("t2-1", makeTask({
      id: "t2-1",
      title: "WS under e2",
      parent: "t2",
      children: [],
    }));

    const db = await getDb(TEST_DB_PATH);
    const result = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    expect(result.epicCount).toBe(2);
    expect(result.taskCount).toBe(2);

    const epics = db.exec("SELECT id, title FROM epics WHERE repo = 'test/repo' ORDER BY id");
    expect(epics[0]?.values.length).toBe(2);
    expect(epics[0].values[0][0]).toBe("e1");
    expect(epics[0].values[1][0]).toBe("e2");

    const tasks = db.exec("SELECT id, epic, title FROM tasks WHERE repo = 'test/repo' ORDER BY id");
    expect(tasks[0]?.values.length).toBe(2);
    expect(tasks[0].values[0][0]).toBe("t1");
    expect(tasks[0].values[0][1]).toBe("e1");
    expect(tasks[0].values[1][0]).toBe("t2");
    expect(tasks[0].values[1][1]).toBe("e2");
  });

  test("cross-epic dependency remapping", async () => {
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Epic 1",
      children: ["t1-1"],
    }));
    writeStateFile("t1-1", makeTask({
      id: "t1-1",
      title: "Task in E1",
      parent: "t1",
      children: [],
    }));
    writeStateFile("t2", makeTask({
      id: "t2",
      title: "Epic 2",
      children: ["t2-1"],
    }));
    writeStateFile("t2-1", makeTask({
      id: "t2-1",
      title: "Task in E2, depends on E1 task",
      parent: "t2",
      children: [],
      dependencies: ["t1-1"],
    }));

    const db = await getDb(TEST_DB_PATH);
    await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    const tasks = db.exec("SELECT id, dependencies FROM tasks WHERE repo = 'test/repo' ORDER BY id");
    // t2-1 → t2, dependency t1-1 → t1
    const t2Row = tasks[0]?.values.find((r: any[]) => r[0] === "t2");
    const deps = JSON.parse(t2Row![1] as string);
    expect(deps).toEqual(["t1"]);
  });

  test("mixed standalone and epic tasks", async () => {
    // t1 is standalone
    writeStateFile("t1", makeTask({
      id: "t1",
      title: "Standalone",
      parent: null,
      children: [],
    }));
    // t2 is a parent with workstreams
    writeStateFile("t2", makeTask({
      id: "t2",
      title: "Epic",
      children: ["t2-1"],
    }));
    writeStateFile("t2-1", makeTask({
      id: "t2-1",
      title: "Workstream",
      parent: "t2",
      children: [],
    }));

    const db = await getDb(TEST_DB_PATH);
    const result = await migrateJsonToSqlite(db, "test/repo", TEST_STATE_DIR);

    expect(result.epicCount).toBe(1);
    expect(result.taskCount).toBe(2); // 1 standalone + 1 workstream

    // Standalone: t1 stays t1
    // Epic: t2 → e1
    // Workstream: t2-1 → t2
    const epics = db.exec("SELECT id FROM epics WHERE repo = 'test/repo'");
    expect(epics[0]?.values[0]?.[0]).toBe("e1");

    const tasks = db.exec("SELECT id, epic FROM tasks WHERE repo = 'test/repo' ORDER BY id");
    expect(tasks[0]?.values.length).toBe(2);
    // t1 = standalone
    expect(tasks[0].values[0][0]).toBe("t1");
    expect(tasks[0].values[0][1]).toBe(null);
    // t2 = workstream from t2-1
    expect(tasks[0].values[1][0]).toBe("t2");
    expect(tasks[0].values[1][1]).toBe("e1");
  });
});
