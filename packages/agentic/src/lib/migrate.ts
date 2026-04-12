import fs from "node:fs";
import path from "node:path";

type Database = any;

// ── Types ──────────────────────────────────────────────────────────

interface OldTask {
  id: string;
  title: string;
  description: string;
  phase: string;
  parent: string | null;
  children: string[];
  dependencies: string[];
  branch: string | null;
  worktree: string | null;
  pr: string | null;
  externalId: string | null;
  plan: string | null;
  qaResult: { status: string; summary: string; timestamp: string } | null;
  transitions: { phase: string; timestamp: string; actor: string }[];
  createdAt: string;
}

export interface MigrationResult {
  migrated: boolean;
  reason?: "already_migrated" | "no_state_dir";
  epicCount?: number;
  taskCount?: number;
  idMapping?: Record<string, string>;
}

// ── Migration ──────────────────────────────────────────────────────

/**
 * Migrate JSON state files from a repo's `.glorious/state/` directory
 * into the SQLite database. Idempotent — skips if already migrated.
 */
export async function migrateJsonToSqlite(
  db: Database,
  repo: string,
  stateDir: string,
): Promise<MigrationResult> {
  // Check if state directory exists
  if (!fs.existsSync(stateDir)) {
    return { migrated: false, reason: "no_state_dir" };
  }

  // Check if already migrated
  const existing = db.exec("SELECT repo FROM migrations WHERE repo = ?", [repo]);
  if (existing.length > 0 && existing[0]?.values.length > 0) {
    return { migrated: false, reason: "already_migrated" };
  }

  // Read all task JSON files
  const files = fs.readdirSync(stateDir).filter((f: string) => f.endsWith(".json") && !f.includes(".pipeline."));
  const tasks: OldTask[] = files.map((f: string) =>
    JSON.parse(fs.readFileSync(path.join(stateDir, f), "utf-8"))
  );

  // Classify tasks
  const parentTasks = tasks.filter((t) => t.children.length > 0);
  const workstreams = tasks.filter((t) => t.parent !== null);
  const standaloneTasks = tasks.filter((t) => t.parent === null && t.children.length === 0);

  // Build ID mapping
  // Parent tasks → epics: t1 → e1, t2 → e2, etc.
  // Sort parents by their numeric suffix for stable ordering
  const sortedParents = [...parentTasks].sort((a, b) => {
    const aNum = parseInt(a.id.replace("t", ""), 10);
    const bNum = parseInt(b.id.replace("t", ""), 10);
    return aNum - bNum;
  });

  const idMapping: Record<string, string> = {};
  let epicCounter = 1;
  for (const parent of sortedParents) {
    idMapping[parent.id] = `e${epicCounter++}`;
  }

  // Workstreams → tasks: t1-1 → t1, t1-2 → t2, etc.
  // Sort first by parent, then by workstream suffix for stable ordering
  const sortedWorkstreams = [...workstreams].sort((a, b) => {
    const aParent = a.parent!;
    const bParent = b.parent!;
    if (aParent !== bParent) {
      const aPN = parseInt(aParent.replace("t", ""), 10);
      const bPN = parseInt(bParent.replace("t", ""), 10);
      return aPN - bPN;
    }
    // Same parent — sort by suffix
    const aSuffix = parseInt(a.id.split("-")[1], 10);
    const bSuffix = parseInt(b.id.split("-")[1], 10);
    return aSuffix - bSuffix;
  });

  let taskCounter = 1;

  // Standalone tasks keep t-prefix but get renumbered
  // Sort standalone tasks by their numeric ID
  const sortedStandalone = [...standaloneTasks].sort((a, b) => {
    const aNum = parseInt(a.id.replace("t", ""), 10);
    const bNum = parseInt(b.id.replace("t", ""), 10);
    return aNum - bNum;
  });

  for (const task of sortedStandalone) {
    idMapping[task.id] = `t${taskCounter++}`;
  }

  for (const ws of sortedWorkstreams) {
    idMapping[ws.id] = `t${taskCounter++}`;
  }

  const now = new Date().toISOString();

  // Run everything in a transaction
  db.run("BEGIN TRANSACTION");
  try {
    // Insert epics
    for (const parent of sortedParents) {
      const newId = idMapping[parent.id];
      db.run(
        `INSERT INTO epics (repo, id, title, description, phase, plan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          repo,
          newId,
          parent.title,
          parent.description || "",
          parent.phase,
          parent.plan || null,
          parent.createdAt,
          now,
        ],
      );

      // Insert epic transitions
      for (const t of parent.transitions) {
        db.run(
          `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
           VALUES (?, ?, 'epic', ?, ?, ?)`,
          [repo, newId, t.phase, t.actor, t.timestamp],
        );
      }
    }

    // Helper to remap dependency IDs
    function remapDeps(deps: string[]): string[] {
      return deps.map((d) => idMapping[d] ?? d);
    }

    // Insert standalone tasks
    for (const task of sortedStandalone) {
      insertTask(db, repo, task, idMapping[task.id], null, remapDeps(task.dependencies), now);
    }

    // Insert workstream tasks
    for (const ws of sortedWorkstreams) {
      const epicId = idMapping[ws.parent!];
      insertTask(db, repo, ws, idMapping[ws.id], epicId, remapDeps(ws.dependencies), now);
    }

    // Record migration
    db.run(
      "INSERT INTO migrations (repo, migrated_at, file_count) VALUES (?, ?, ?)",
      [repo, now, files.length],
    );

    db.run("COMMIT");

    return {
      migrated: true,
      epicCount: sortedParents.length,
      taskCount: sortedStandalone.length + sortedWorkstreams.length,
      idMapping,
    };
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

function insertTask(
  db: Database,
  repo: string,
  task: OldTask,
  newId: string,
  epicId: string | null,
  dependencies: string[],
  now: string,
): void {
  db.run(
    `INSERT INTO tasks (repo, id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, plan, plan_version, qa_status, qa_summary, qa_timestamp, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repo,
      newId,
      epicId,
      task.title,
      task.description || "",
      task.phase,
      JSON.stringify(dependencies),
      task.branch || null,
      task.worktree || null,
      task.pr || null,
      task.externalId || null,
      task.plan || null,
      null, // plan_version
      task.qaResult?.status || null,
      task.qaResult?.summary || null,
      task.qaResult?.timestamp || null,
      task.createdAt,
      now,
    ],
  );

  // Insert task transitions
  for (const t of task.transitions) {
    db.run(
      `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
       VALUES (?, ?, 'task', ?, ?, ?)`,
      [repo, newId, t.phase, t.actor, t.timestamp],
    );
  }
}
