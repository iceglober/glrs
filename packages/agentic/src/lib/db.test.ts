import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getDb,
  persistDb,
  getRepo,
  closeDb,
  resetDb,
  normalizeRemoteUrl,
  DB_PATH,
} from "./db.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Use a temp directory for test DB to avoid polluting real state
const TEST_DB_DIR = path.join(os.tmpdir(), "glorious-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "state.db");

describe("db", () => {
  beforeEach(() => {
    // Ensure clean state
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_DIR)) fs.rmSync(TEST_DB_DIR, { recursive: true });
  });

  test("getDb creates database and returns instance", async () => {
    const db = await getDb(TEST_DB_PATH);
    expect(db).toBeTruthy();
  });

  test("getDb returns same instance on repeated calls (singleton)", async () => {
    const db1 = await getDb(TEST_DB_PATH);
    const db2 = await getDb(TEST_DB_PATH);
    expect(db1).toBe(db2);
  });

  test("getDb creates all required tables", async () => {
    const db = await getDb(TEST_DB_PATH);
    const tables = db
      .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      [0]?.values.map((row: any[]) => row[0]) ?? [];

    expect(tables).toContain("epics");
    expect(tables).toContain("tasks");
    expect(tables).toContain("steps");
    expect(tables).toContain("transitions");
    expect(tables).toContain("reviews");
    expect(tables).toContain("review_items");
    expect(tables).toContain("migrations");
  });

  test("persistDb writes database to disk", async () => {
    const db = await getDb(TEST_DB_PATH);
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      "test/repo",
      "e1",
      "Test epic",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    persistDb(TEST_DB_PATH);

    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    const stat = fs.statSync(TEST_DB_PATH);
    expect(stat.size).toBeGreaterThan(0);
  });

  test("persistDb is idempotent", async () => {
    const db = await getDb(TEST_DB_PATH);
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      "test/repo",
      "e1",
      "Test epic",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    persistDb(TEST_DB_PATH);
    const size1 = fs.statSync(TEST_DB_PATH).size;

    persistDb(TEST_DB_PATH);
    const size2 = fs.statSync(TEST_DB_PATH).size;

    expect(size2).toBe(size1);
  });

  test("persisted DB can be reopened with data intact", async () => {
    const db = await getDb(TEST_DB_PATH);
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      "test/repo",
      "e1",
      "Test epic",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    persistDb(TEST_DB_PATH);
    closeDb();

    // Reopen
    const db2 = await getDb(TEST_DB_PATH);
    const result = db2.exec("SELECT title FROM epics WHERE repo = 'test/repo' AND id = 'e1'");
    expect(result[0]?.values[0]?.[0]).toBe("Test epic");
  });

  test("resetDb clears all tables", async () => {
    const db = await getDb(TEST_DB_PATH);
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      "test/repo",
      "e1",
      "Test epic",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);

    resetDb();

    const result = db.exec("SELECT COUNT(*) FROM epics");
    expect(result[0]?.values[0]?.[0]).toBe(0);
  });

  test("resetDb clears steps table", async () => {
    const db = await getDb(TEST_DB_PATH);
    const now = new Date().toISOString();
    // Need an epic and task first for FK constraints
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e1", "Epic", now, now]);
    db.run("INSERT INTO tasks (repo, id, epic, title, phase, dependencies, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["test/repo", "t1", "e1", "Task", "implement", "[]", now, now]);
    db.run("INSERT INTO steps (repo, id, task, title, phase, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["test/repo", "s1", "t1", "Step", "understand", 0, now, now]);

    resetDb();

    const result = db.exec("SELECT COUNT(*) FROM steps");
    expect(result[0]?.values[0]?.[0]).toBe(0);
  });

  test("epics table has plan column not spec", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(epics)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("plan");
    expect(colNames).not.toContain("spec");
  });

  test("tasks table has plan column not spec", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(tasks)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("plan");
    expect(colNames).not.toContain("spec");
  });

  test("epics table has plan_version column", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(epics)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("plan_version");
  });

  test("tasks table has plan_version column", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(tasks)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("plan_version");
  });

  test("closeDb allows reopening", async () => {
    await getDb(TEST_DB_PATH);
    closeDb();
    const db2 = await getDb(TEST_DB_PATH);
    expect(db2).toBeTruthy();
  });
});

describe("normalizeRemoteUrl", () => {
  test("normalizes SSH URL", () => {
    expect(normalizeRemoteUrl("git@github.com:user/repo.git")).toBe("github.com/user/repo");
  });

  test("normalizes HTTPS URL", () => {
    expect(normalizeRemoteUrl("https://github.com/user/repo.git")).toBe("github.com/user/repo");
  });

  test("normalizes HTTPS URL without .git suffix", () => {
    expect(normalizeRemoteUrl("https://github.com/user/repo")).toBe("github.com/user/repo");
  });

  test("normalizes SSH URL without .git suffix", () => {
    expect(normalizeRemoteUrl("git@github.com:user/repo")).toBe("github.com/user/repo");
  });

  test("lowercases the result", () => {
    expect(normalizeRemoteUrl("git@GitHub.COM:User/Repo.git")).toBe("github.com/user/repo");
  });

  test("handles ssh:// protocol", () => {
    expect(normalizeRemoteUrl("ssh://git@github.com/user/repo.git")).toBe("github.com/user/repo");
  });

  test("handles http:// protocol", () => {
    expect(normalizeRemoteUrl("http://github.com/user/repo.git")).toBe("github.com/user/repo");
  });
});

describe("getRepo", () => {
  test("returns a string when inside a git repo", () => {
    // We're running tests from inside the glorious repo, so this should work
    const repo = getRepo();
    expect(repo).toBeTruthy();
    expect(typeof repo).toBe("string");
  });

  test("returns consistent results on repeated calls", () => {
    const repo1 = getRepo();
    const repo2 = getRepo();
    expect(repo1).toBe(repo2);
  });
});
