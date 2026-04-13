import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getDb,
  getDbSync,
  persistDb,
  getRepo,
  closeDb,
  resetDb,
  reloadDb,
  withDbLock,
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

  test("tasks table has claimed_by column", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(tasks)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("claimed_by");
  });

  test("tasks table has claimed_at column", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(tasks)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("claimed_at");
  });

  test("task_notes table has ephemeral column", async () => {
    const db = await getDb(TEST_DB_PATH);
    const cols = db.exec("PRAGMA table_info(task_notes)");
    const colNames = cols[0]?.values.map((row: any[]) => row[1]) ?? [];
    expect(colNames).toContain("ephemeral");
  });

  test("claimed_by defaults to NULL on new tasks", async () => {
    const db = await getDb(TEST_DB_PATH);
    const now = new Date().toISOString();
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e1", "Epic", now, now]);
    db.run("INSERT INTO tasks (repo, id, epic, title, phase, dependencies, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["test/repo", "t1", "e1", "Task", "understand", "[]", now, now]);
    const result = db.exec("SELECT claimed_by FROM tasks WHERE repo = 'test/repo' AND id = 't1'");
    expect(result[0]?.values[0]?.[0]).toBeNull();
  });

  test("ephemeral defaults to 0 on new task_notes", async () => {
    const db = await getDb(TEST_DB_PATH);
    const now = new Date().toISOString();
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e1", "Epic", now, now]);
    db.run("INSERT INTO tasks (repo, id, epic, title, phase, dependencies, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["test/repo", "t1", "e1", "Task", "understand", "[]", now, now]);
    db.run("INSERT INTO task_notes (repo, id, task_id, body, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["test/repo", "n1", "t1", "test note", "cli", now]);
    const result = db.exec("SELECT ephemeral FROM task_notes WHERE repo = 'test/repo' AND id = 'n1'");
    expect(result[0]?.values[0]?.[0]).toBe(0);
  });

  test("closeDb allows reopening", async () => {
    await getDb(TEST_DB_PATH);
    closeDb();
    const db2 = await getDb(TEST_DB_PATH);
    expect(db2).toBeTruthy();
  });

  // ── reloadDb ─────────────────────────────────────────────────────

  test("reloadDb picks up external disk changes", async () => {
    // Write data via the normal path
    const db = await getDb(TEST_DB_PATH);
    const now = new Date().toISOString();
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e1", "Original", now, now]);
    persistDb(TEST_DB_PATH);

    // Simulate another process writing to the DB file directly
    // @ts-ignore -- sql.js has no type declarations
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(TEST_DB_PATH);
    const extDb = new SQL.Database(buffer);
    extDb.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e2", "External", now, now]);
    const extData = extDb.export();
    fs.writeFileSync(TEST_DB_PATH, Buffer.from(extData));
    extDb.close();

    // Before reload, the in-memory DB doesn't see e2
    const beforeReload = db.exec("SELECT id FROM epics WHERE repo = 'test/repo' ORDER BY id");
    expect(beforeReload[0]?.values.length).toBe(1);

    // After reload, e2 should be visible
    reloadDb();
    const afterReload = getDb(TEST_DB_PATH);
    const db2 = await afterReload;
    const result = db2.exec("SELECT id FROM epics WHERE repo = 'test/repo' ORDER BY id");
    expect(result[0]?.values.length).toBe(2);
    expect(result[0]?.values[1]?.[0]).toBe("e2");
  });

  test("reloadDb is no-op when DB not initialized", () => {
    closeDb();
    expect(() => reloadDb()).not.toThrow();
  });

  test("reloadDb preserves activePath after reload", async () => {
    const db = await getDb(TEST_DB_PATH);
    persistDb(TEST_DB_PATH); // ensure file exists on disk
    reloadDb();
    // After reload, persistDb should still write to TEST_DB_PATH (not DB_PATH)
    const now = new Date().toISOString();
    const db2 = await getDb(TEST_DB_PATH);
    // Verify DB is empty (clean reload)
    const before = db2.exec("SELECT COUNT(*) FROM epics");
    expect(before[0]?.values[0]?.[0]).toBe(0);

    db2.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e99", "After reload", now, now]);
    persistDb(); // no explicit path — should use activePath
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

    // Verify data persisted correctly by reopening
    closeDb();
    const db3 = await getDb(TEST_DB_PATH);
    const result = db3.exec("SELECT title FROM epics WHERE repo = 'test/repo' AND id = 'e99'");
    expect(result[0]?.values[0]?.[0]).toBe("After reload");
  });

  // ── withDbLock ────────────────────────────────────────────────────

  test("withDbLock acquires and releases lock file", async () => {
    await getDb(TEST_DB_PATH);
    persistDb(TEST_DB_PATH);
    const lockPath = TEST_DB_PATH + ".lock";

    withDbLock(() => {
      // Lock should exist during callback
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    // Lock should be released after callback
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("withDbLock reloads DB before running callback", async () => {
    const db = await getDb(TEST_DB_PATH);
    const now = new Date().toISOString();
    db.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e1", "Original", now, now]);
    persistDb(TEST_DB_PATH);

    // Simulate external write
    // @ts-ignore -- sql.js has no type declarations
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(TEST_DB_PATH);
    const extDb = new SQL.Database(buffer);
    extDb.run("INSERT INTO epics (repo, id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["test/repo", "e2", "External", now, now]);
    fs.writeFileSync(TEST_DB_PATH, Buffer.from(extDb.export()));
    extDb.close();

    // In-memory DB only sees e1
    const before = db.exec("SELECT COUNT(*) FROM epics WHERE repo = 'test/repo'");
    expect(before[0]?.values[0]?.[0]).toBe(1);

    // withDbLock reloads from disk — callback should see both epics
    const count = withDbLock(() => {
      const reloadedDb = getDbSync();
      const result = reloadedDb.exec("SELECT COUNT(*) FROM epics WHERE repo = 'test/repo'");
      return result[0]?.values[0]?.[0] as number;
    });
    expect(count).toBe(2);
  });

  test("withDbLock releases lock even on callback error", async () => {
    await getDb(TEST_DB_PATH);
    persistDb(TEST_DB_PATH);
    const lockPath = TEST_DB_PATH + ".lock";

    expect(() => {
      withDbLock(() => { throw new Error("boom"); });
    }).toThrow("boom");

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("withDbLock times out when lock is held by current process", async () => {
    await getDb(TEST_DB_PATH);
    persistDb(TEST_DB_PATH);
    const lockPath = TEST_DB_PATH + ".lock";

    // Manually create a lock with current PID (so it won't be detected as stale)
    fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}`);

    try {
      expect(() => {
        withDbLock(() => {}, 200); // 200ms timeout
      }).toThrow(/lock/i);
    } finally {
      // Cleanup
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  });

  test("withDbLock cleans up stale lock (dead PID)", async () => {
    await getDb(TEST_DB_PATH);
    persistDb(TEST_DB_PATH);
    const lockPath = TEST_DB_PATH + ".lock";

    // Create lock with a PID that doesn't exist
    fs.writeFileSync(lockPath, `999999999\n${Date.now()}`);

    // withDbLock should clean up the stale lock and succeed
    let ran = false;
    withDbLock(() => { ran = true; });
    expect(ran).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("withDbLock returns callback result", async () => {
    await getDb(TEST_DB_PATH);
    persistDb(TEST_DB_PATH);
    const result = withDbLock(() => 42);
    expect(result).toBe(42);
  });

  test("getDb works after closeDb (sqlModule cached)", async () => {
    await getDb(TEST_DB_PATH);
    closeDb();
    // Second getDb should succeed using cached sqlModule
    const db2 = await getDb(TEST_DB_PATH);
    expect(db2).toBeTruthy();
    const tables = db2.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    expect(tables[0]?.values.length).toBeGreaterThan(0);
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
