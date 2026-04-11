// @ts-ignore -- sql.js has no type declarations
import initSqlJs from "sql.js";
declare const __SQL_WASM_BASE64__: string | undefined;
type Database = any;
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { gitSafe } from "./git.js";

// ── Singleton ───────────────────────────────────────────────────────

let db: Database | null = null;
let activePath: string | null = null;

/** Default path for the global state database. */
export const DB_PATH = path.join(os.homedir(), ".glorious", "state.db");

/** Get or create the SQLite database. Pass a custom path for testing. */
export async function getDb(dbPath: string = DB_PATH): Promise<Database> {
  if (db) return db;

  const opts = typeof __SQL_WASM_BASE64__ !== "undefined"
    ? { wasmBinary: Buffer.from(__SQL_WASM_BASE64__, "base64") }
    : undefined;
  const SQL = await initSqlJs(opts);

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  activePath = dbPath;
  runSchema(db);
  return db;
}

/** Write the in-memory database to disk. Call after every write operation. */
export function persistDb(dbPath: string = activePath ?? DB_PATH): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, buffer);
}

/** Get the database synchronously. Throws if not initialized via getDb() first. */
export function getDbSync(): Database {
  if (!db) throw new Error("Database not initialized. Call getDb() first.");
  return db;
}

/** Close the database and clear the singleton. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    activePath = null;
  }
}

/** Clear all data from all tables (for test isolation). */
export function resetDb(): void {
  if (!db) return;
  const tables = ["review_items", "reviews", "transitions", "tasks", "epics", "migrations"];
  for (const table of tables) {
    db.run(`DELETE FROM ${table}`);
  }
}

// ── Schema ──────────────────────────────────────────────────────────

function runSchema(database: Database): void {
  database.run("PRAGMA foreign_keys = ON");

  database.run(`
    CREATE TABLE IF NOT EXISTS epics (
      repo        TEXT NOT NULL,
      id          TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      phase       TEXT NOT NULL DEFAULT 'understand',
      spec        TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (repo, id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      repo         TEXT NOT NULL,
      id           TEXT NOT NULL,
      epic         TEXT,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      phase        TEXT NOT NULL DEFAULT 'understand',
      dependencies TEXT NOT NULL DEFAULT '[]',
      branch       TEXT,
      worktree     TEXT,
      pr           TEXT,
      external_id  TEXT,
      spec         TEXT,
      qa_status    TEXT,
      qa_summary   TEXT,
      qa_timestamp TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (repo, id),
      FOREIGN KEY (repo, epic) REFERENCES epics(repo, id) ON DELETE SET NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS transitions (
      repo      TEXT NOT NULL,
      task_id   TEXT NOT NULL,
      entity    TEXT NOT NULL DEFAULT 'task',
      phase     TEXT NOT NULL,
      actor     TEXT NOT NULL DEFAULT 'cli',
      timestamp TEXT NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      repo         TEXT NOT NULL,
      id           TEXT NOT NULL,
      task_id      TEXT,
      epic_id      TEXT,
      source       TEXT NOT NULL,
      commit_sha   TEXT NOT NULL,
      pr_number    INTEGER,
      summary      TEXT,
      created_at   TEXT NOT NULL,
      PRIMARY KEY (repo, id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS review_items (
      repo            TEXT NOT NULL,
      id              TEXT NOT NULL,
      review_id       TEXT NOT NULL,
      severity        TEXT,
      agents          TEXT NOT NULL DEFAULT '[]',
      file_path       TEXT,
      line_start      INTEGER,
      line_end        INTEGER,
      body            TEXT NOT NULL,
      impact          TEXT,
      suggested_fix   TEXT,
      status          TEXT NOT NULL DEFAULT 'open',
      resolution      TEXT,
      resolution_sha  TEXT,
      pr_comment_id   INTEGER,
      resolved_at     TEXT,
      PRIMARY KEY (repo, id),
      FOREIGN KEY (repo, review_id) REFERENCES reviews(repo, id) ON DELETE CASCADE
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      repo        TEXT PRIMARY KEY,
      migrated_at TEXT NOT NULL,
      file_count  INTEGER NOT NULL
    )
  `);

  // Indexes (CREATE INDEX IF NOT EXISTS is safe to run repeatedly)
  database.run("CREATE INDEX IF NOT EXISTS idx_tasks_branch   ON tasks(repo, branch)");
  database.run("CREATE INDEX IF NOT EXISTS idx_tasks_worktree ON tasks(repo, worktree)");
  database.run("CREATE INDEX IF NOT EXISTS idx_tasks_epic     ON tasks(repo, epic)");
  database.run("CREATE INDEX IF NOT EXISTS idx_tasks_phase    ON tasks(repo, phase)");
  database.run("CREATE INDEX IF NOT EXISTS idx_transitions_entity ON transitions(repo, entity, task_id)");
  database.run("CREATE INDEX IF NOT EXISTS idx_reviews_task   ON reviews(repo, task_id)");
  database.run("CREATE INDEX IF NOT EXISTS idx_reviews_commit ON reviews(repo, commit_sha)");
  database.run("CREATE INDEX IF NOT EXISTS idx_review_items_review  ON review_items(repo, review_id)");
  database.run("CREATE INDEX IF NOT EXISTS idx_review_items_status  ON review_items(repo, status)");
  database.run("CREATE INDEX IF NOT EXISTS idx_review_items_severity ON review_items(repo, severity)");
}

// ── Repo identification ─────────────────────────────────────────────

let cachedRepo: string | null | undefined;

/** Normalize a git remote URL to a stable repo identifier. */
export function normalizeRemoteUrl(url: string): string {
  let normalized = url.toLowerCase();
  // Strip protocols
  normalized = normalized.replace(/^(https?|ssh|git):\/\//, "");
  // Strip git@ prefix and convert : to /
  normalized = normalized.replace(/^git@/, "");
  normalized = normalized.replace(/:(?!\/)/, "/");
  // Strip .git suffix
  normalized = normalized.replace(/\.git$/, "");
  // Strip leading slashes or user info
  normalized = normalized.replace(/^[^@]*@/, "");
  return normalized;
}

/** Get the current repo identifier. Returns null if not in a git repo. */
export function getRepo(): string | null {
  if (cachedRepo !== undefined) return cachedRepo;

  // Try remote URL first
  const remoteUrl = gitSafe("remote", "get-url", "origin");
  if (remoteUrl) {
    cachedRepo = normalizeRemoteUrl(remoteUrl);
    return cachedRepo;
  }

  // Fallback to git root path
  const root = gitSafe("rev-parse", "--show-toplevel");
  if (root) {
    cachedRepo = root;
    return cachedRepo;
  }

  cachedRepo = null;
  return null;
}

/** Reset the cached repo (for testing). */
export function resetRepoCache(): void {
  cachedRepo = undefined;
}
