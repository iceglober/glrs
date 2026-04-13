import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { gitRoot, gitSafe } from "./git.js";
import { getDb, getDbSync, persistDb, withDbLock, getRepo, closeDb, resetDb, resetRepoCache, DB_PATH } from "./db.js";

// ── Types ────────────────────────────────────────────────────────────

export const PHASES = ["understand", "design", "implement", "verify", "ship", "done", "cancelled"] as const;
export type Phase = (typeof PHASES)[number];

const ORDERED_PHASES: Phase[] = ["understand", "design", "implement", "verify", "ship", "done"];
const TERMINAL: Phase[] = ["done", "cancelled"];

export interface Transition {
  phase: Phase;
  timestamp: string;
  actor: string;
}

export interface QAResult {
  status: "pass" | "fail";
  summary: string;
  timestamp: string;
}

export interface Epic {
  id: string;
  title: string;
  description: string;
  phase: Phase;
  plan: string | null;
  planVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  epic: string | null;
  title: string;
  description: string;
  phase: Phase;
  dependencies: string[];
  branch: string | null;
  worktree: string | null;
  pr: string | null;
  externalId: string | null;
  plan: string | null;
  planVersion: number | null;
  qaResult: QAResult | null;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  children: string[];
  transitions: Transition[];
}

export interface Step {
  id: string;
  task: string;
  title: string;
  description: string;
  phase: Phase;
  sortOrder: number;
  plan: string | null;
  planVersion: number | null;
  createdAt: string;
  updatedAt: string;
}


// ── Initialization ──────────────────────────────────────────────────

/** Initialize the state module. Must be called before any other state functions. */
export async function initState(dbPath: string = DB_PATH): Promise<void> {
  await getDb(dbPath);
}

/** Clean up state module (for tests). */
export function cleanupState(): void {
  closeDb();
  resetRepoCache();
}

// ── Paths (plans in global ~/.glorious/plans/) ─────────────────────

let _testPlansDir: string | null = null;

/** Override the plans directory (for testing). */
export function setPlansDir(dir: string | null): void {
  _testPlansDir = dir;
}

export function plansDir(): string {
  if (_testPlansDir) return _testPlansDir;
  const repoId = getRepo();
  const slug = repoId ? repoId.replace(/\//g, "-") : "local";
  return path.join(os.homedir(), ".glorious", "plans", slug);
}

function planVersionPath(id: string, version: number): string {
  return path.join(plansDir(), id, `v${version}.md`);
}

// ── Auto-setup ──────────────────────────────────────────────────────

/** Ensure plans directory and gitignore are configured. */
export function ensureSetup(): void {
  const pd = plansDir();
  if (!fs.existsSync(pd)) fs.mkdirSync(pd, { recursive: true });

  // Also ensure the old state dir entry is in gitignore (harmless)
  const root = gitRoot();
  const gi = path.join(root, ".gitignore");
  const entry = ".glorious/state/";

  if (fs.existsSync(gi)) {
    const content = fs.readFileSync(gi, "utf-8");
    if (!content.includes(entry)) {
      fs.appendFileSync(gi, `\n# glorious local state (per-engineer, not shared)\n${entry}\n`);
    }
  } else {
    fs.writeFileSync(gi, `# glorious local state (per-engineer, not shared)\n${entry}\n`);
  }
}

// ── Repo helper ─────────────────────────────────────────────────────

function repo(): string {
  const r = getRepo();
  if (!r) throw new Error("Not in a git repository.");
  return r;
}

// ── Actor resolution ────────────────────────────────────────────────

/**
 * Resolve the actor identity via cascade:
 * explicit arg → GSAG_ACTOR env → git config user.name → "cli"
 */
export function resolveActor(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env.GSAG_ACTOR;
  if (env) return env;
  const gitName = gitSafe("config", "user.name");
  if (gitName) return gitName;
  return "cli";
}

// ── Last-touched context ────────────────────────────────────────────

const LAST_TOUCHED_PATH = path.join(os.homedir(), ".glorious", ".last-task");

/** Persist the last-touched task ID for this repo. */
export function touchTask(taskId: string): void {
  const dir = path.dirname(LAST_TOUCHED_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LAST_TOUCHED_PATH, `${repo()}\t${taskId}\n`);
}

/** Get the last-touched task ID for the current repo, or null. */
export function getLastTouched(): string | null {
  try {
    const content = fs.readFileSync(LAST_TOUCHED_PATH, "utf-8").trim();
    const parts = content.split("\t");
    if (parts.length !== 2) return null;
    const [savedRepo, taskId] = parts;
    if (savedRepo !== repo()) return null;
    return taskId;
  } catch {
    return null;
  }
}

// ── ID generation ───────────────────────────────────────────────────

/** Generate next epic ID (e1, e2, ...) */
export function nextEpicId(): string {
  const db = getDbSync();
  const result = db.exec(
    "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) FROM epics WHERE repo = ?",
    [repo()],
  );
  const max = result[0]?.values[0]?.[0] ?? 0;
  return `e${(max || 0) + 1}`;
}

/** Generate next task ID (t1, t2, ...) */
export function nextTaskId(): string {
  const db = getDbSync();
  const result = db.exec(
    "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) FROM tasks WHERE repo = ?",
    [repo()],
  );
  const max = result[0]?.values[0]?.[0] ?? 0;
  return `t${(max || 0) + 1}`;
}

/** Generate next step ID (s1, s2, ...) */
export function nextStepId(): string {
  const db = getDbSync();
  const result = db.exec(
    "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) FROM steps WHERE repo = ?",
    [repo()],
  );
  const max = result[0]?.values[0]?.[0] ?? 0;
  return `s${(max || 0) + 1}`;
}

// ── Step CRUD ──────────────────────────────────────────────────────

const STEP_SELECT = `SELECT id, task, title, description, phase, sort_order, plan, plan_version, created_at, updated_at FROM steps`;

function rowToStep(row: any[]): Step {
  return {
    id: row[0] as string,
    task: row[1] as string,
    title: row[2] as string,
    description: row[3] as string,
    phase: row[4] as Phase,
    sortOrder: row[5] as number,
    plan: row[6] as string | null,
    planVersion: row[7] as number | null,
    createdAt: row[8] as string,
    updatedAt: row[9] as string,
  };
}

export function createStep(opts: {
  title: string;
  task: string;
  description?: string;
  phase?: Phase;
  sortOrder?: number;
  actor?: string;
}): Step {
  const db = getDbSync();
  const id = nextStepId();
  const now = new Date().toISOString();
  const phase = opts.phase ?? "understand";
  const sortOrder = opts.sortOrder ?? 0;

  db.run(
    `INSERT INTO steps (repo, id, task, title, description, phase, sort_order, plan, plan_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [repo(), id, opts.task, opts.title, opts.description ?? "", phase, sortOrder, now, now],
  );

  // Record transition
  db.run(
    `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
     VALUES (?, ?, 'step', ?, ?, ?)`,
    [repo(), id, phase, resolveActor(opts.actor), now],
  );

  persistDb();

  return {
    id,
    task: opts.task,
    title: opts.title,
    description: opts.description ?? "",
    phase,
    sortOrder,
    plan: null,
    planVersion: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadStep(id: string): Step | null {
  const db = getDbSync();
  const result = db.exec(`${STEP_SELECT} WHERE repo = ? AND id = ?`, [repo(), id]);
  if (!result[0]?.values.length) return null;
  return rowToStep(result[0].values[0]);
}

export function listSteps(opts?: { task?: string }): Step[] {
  const db = getDbSync();
  let query = `${STEP_SELECT} WHERE repo = ?`;
  const params: any[] = [repo()];

  if (opts?.task) {
    query += " AND task = ?";
    params.push(opts.task);
  }

  query += " ORDER BY sort_order, id";

  const result = db.exec(query, params);
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => rowToStep(row));
}

export function saveStep(step: Step): void {
  const db = getDbSync();
  const now = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO steps (repo, id, task, title, description, phase, sort_order, plan, plan_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repo(),
      step.id,
      step.task,
      step.title,
      step.description,
      step.phase,
      step.sortOrder,
      step.plan,
      step.planVersion,
      step.createdAt,
      now,
    ],
  );
  persistDb();
  step.updatedAt = now;
}

// ── Epic CRUD ───────────────────────────────────────────────────────

export function createEpic(opts: {
  title: string;
  description?: string;
  phase?: Phase;
  plan?: string;
}): Epic {
  const db = getDbSync();
  const id = nextEpicId();
  const now = new Date().toISOString();
  const phase = opts.phase ?? "understand";

  db.run(
    `INSERT INTO epics (repo, id, title, description, phase, plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [repo(), id, opts.title, opts.description ?? "", phase, opts.plan ?? null, now, now],
  );

  // Record initial transition
  db.run(
    `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
     VALUES (?, ?, 'epic', ?, 'cli', ?)`,
    [repo(), id, phase, now],
  );

  persistDb();

  return {
    id,
    title: opts.title,
    description: opts.description ?? "",
    phase,
    plan: opts.plan ?? null,
    planVersion: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadEpic(id: string, repoId?: string): Epic | null {
  const db = getDbSync();
  const result = db.exec(
    "SELECT id, title, description, phase, plan, plan_version, created_at, updated_at FROM epics WHERE repo = ? AND id = ?",
    [repoId ?? repo(), id],
  );
  if (!result[0]?.values.length) return null;
  const row = result[0].values[0];
  return {
    id: row[0] as string,
    title: row[1] as string,
    description: row[2] as string,
    phase: row[3] as Phase,
    plan: row[4] as string | null,
    planVersion: row[5] as number | null,
    createdAt: row[6] as string,
    updatedAt: row[7] as string,
  };
}

export function listEpics(opts?: { all?: boolean }): (Epic & { repo?: string })[] {
  const db = getDbSync();
  const selectRepo = opts?.all;
  let query = selectRepo
    ? "SELECT id, title, description, phase, plan, plan_version, created_at, updated_at, repo FROM epics WHERE 1=1"
    : "SELECT id, title, description, phase, plan, plan_version, created_at, updated_at FROM epics WHERE repo = ?";
  const params: any[] = selectRepo ? [] : [repo()];
  query += " ORDER BY id";
  const result = db.exec(query, params);
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => ({
    id: row[0] as string,
    title: row[1] as string,
    description: row[2] as string,
    phase: row[3] as Phase,
    plan: row[4] as string | null,
    planVersion: row[5] as number | null,
    createdAt: row[6] as string,
    updatedAt: row[7] as string,
    ...(selectRepo ? { repo: row[8] as string } : {}),
  }));
}

export function listAllRepos(): string[] {
  const db = getDbSync();
  const result = db.exec(
    "SELECT DISTINCT repo FROM epics UNION SELECT DISTINCT repo FROM tasks ORDER BY repo",
  );
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => row[0] as string);
}

// ── Task CRUD ───────────────────────────────────────────────────────

function rowToTask(row: any[], transitions: Transition[], children: string[]): Task {
  const qaStatus = row[13] as string | null;
  const qaSummary = row[14] as string | null;
  const qaTimestamp = row[15] as string | null;

  return {
    id: row[0] as string,
    epic: row[1] as string | null,
    title: row[2] as string,
    description: row[3] as string,
    phase: row[4] as Phase,
    dependencies: JSON.parse((row[5] as string) || "[]"),
    branch: row[6] as string | null,
    worktree: row[7] as string | null,
    pr: row[8] as string | null,
    externalId: row[9] as string | null,
    plan: row[10] as string | null,
    planVersion: row[11] as number | null,
    createdAt: row[12] as string,
    updatedAt: row[16] as string,
    qaResult: qaStatus ? { status: qaStatus as "pass" | "fail", summary: qaSummary!, timestamp: qaTimestamp! } : null,
    claimedBy: row[17] as string | null,
    claimedAt: row[18] as string | null,
    children,
    transitions,
  };
}

function loadTransitions(taskId: string, entity: string = "task"): Transition[] {
  const db = getDbSync();
  const result = db.exec(
    "SELECT phase, timestamp, actor FROM transitions WHERE repo = ? AND task_id = ? AND entity = ? ORDER BY timestamp",
    [repo(), taskId, entity],
  );
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => ({
    phase: row[0] as Phase,
    timestamp: row[1] as string,
    actor: row[2] as string,
  }));
}

function loadChildren(taskId: string): string[] {
  const db = getDbSync();
  const result = db.exec(
    "SELECT id FROM tasks WHERE repo = ? AND epic = ? ORDER BY id",
    [repo(), taskId],
  );
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => row[0] as string);
}

const TASK_SELECT = `SELECT id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, plan, plan_version, created_at, qa_status, qa_summary, qa_timestamp, updated_at, claimed_by, claimed_at FROM tasks`;

export function loadTask(id: string): Task | null {
  const db = getDbSync();
  const result = db.exec(`${TASK_SELECT} WHERE repo = ? AND id = ?`, [repo(), id]);
  if (!result[0]?.values.length) return null;
  const transitions = loadTransitions(id, "task");
  const children = loadChildren(id);
  return rowToTask(result[0].values[0], transitions, children);
}

export function saveTask(task: Task): void {
  const db = getDbSync();
  const now = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO tasks (repo, id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, plan, plan_version, qa_status, qa_summary, qa_timestamp, claimed_by, claimed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repo(),
      task.id,
      task.epic,
      task.title,
      task.description,
      task.phase,
      JSON.stringify(task.dependencies),
      task.branch,
      task.worktree,
      task.pr,
      task.externalId,
      task.plan,
      task.planVersion,
      task.qaResult?.status ?? null,
      task.qaResult?.summary ?? null,
      task.qaResult?.timestamp ?? null,
      task.claimedBy,
      task.claimedAt,
      task.createdAt,
      now,
    ],
  );
  persistDb();
  task.updatedAt = now;
  touchTask(task.id);
}

export function listTasks(opts?: { epic?: string; all?: boolean; lean?: boolean }): (Task & { repo?: string })[] {
  const db = getDbSync();
  const selectRepo = opts?.all;
  let query: string;
  const params: any[] = [];

  if (selectRepo) {
    query = `SELECT id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, plan, plan_version, created_at, qa_status, qa_summary, qa_timestamp, updated_at, claimed_by, claimed_at, repo FROM tasks WHERE 1=1`;
  } else {
    query = `${TASK_SELECT} WHERE repo = ?`;
    params.push(repo());
  }

  if (opts?.epic) {
    query += " AND epic = ?";
    params.push(opts.epic);
  }

  query += " ORDER BY id";

  const result = db.exec(query, params);
  if (!result[0]?.values.length) return [];

  // When selectRepo, repo is the last column (index 19)
  const repoIdx = 19;

  return result[0].values.map((row: any[]) => {
    const id = row[0] as string;
    const repoField = selectRepo ? { repo: row[repoIdx] as string } : {};
    if (opts?.lean) {
      // Compact object: only non-null, non-empty fields. Skip transitions/children queries.
      const compact: Record<string, any> = { id, title: row[2] as string, phase: row[4] as Phase, ...repoField };
      const epic = row[1] as string | null;
      if (epic) compact.epic = epic;
      const branch = row[6] as string | null;
      if (branch) compact.branch = branch;
      const deps = JSON.parse((row[5] as string) || "[]");
      if (deps.length > 0) compact.dependencies = deps;
      const qaStatus = row[13] as string | null;
      if (qaStatus) compact.qaResult = { status: qaStatus, summary: row[14] as string };
      const claimedBy = row[17] as string | null;
      if (claimedBy) compact.claimedBy = claimedBy;
      return compact as Task;
    }
    const transitions = loadTransitions(id, "task");
    const children = loadChildren(id);
    return { ...rowToTask(row, transitions, children), ...repoField };
  });
}

export function createTask(opts: {
  title: string;
  description?: string;
  epic?: string;
  phase?: Phase;
  actor?: string;
}): Task {
  const db = getDbSync();
  const id = nextTaskId();
  const now = new Date().toISOString();
  const phase = opts.phase ?? "understand";
  const epic = opts.epic ?? null;

  db.run(
    `INSERT INTO tasks (repo, id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, plan, plan_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    [repo(), id, epic, opts.title, opts.description ?? "", phase, now, now],
  );

  // Record initial transition
  db.run(
    `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
     VALUES (?, ?, 'task', ?, ?, ?)`,
    [repo(), id, phase, resolveActor(opts.actor), now],
  );

  persistDb();

  const task: Task = {
    id,
    epic,
    title: opts.title,
    description: opts.description ?? "",
    phase,
    dependencies: [],
    branch: null,
    worktree: null,
    pr: null,
    externalId: null,
    plan: null,
    planVersion: null,
    qaResult: null,
    claimedBy: null,
    claimedAt: null,
    createdAt: now,
    updatedAt: now,
    children: [],
    transitions: [{ phase, timestamp: now, actor: resolveActor(opts.actor) }],
  };
  touchTask(task.id);
  return task;
}

// ── Phase transitions ───────────────────────────────────────────────

function phaseIndex(p: Phase): number {
  return ORDERED_PHASES.indexOf(p);
}

export function isTerminal(p: Phase): boolean {
  return TERMINAL.includes(p);
}

export function validateTransition(current: Phase, target: Phase, force: boolean): string | null {
  if (isTerminal(current)) {
    return `Task is already in terminal phase "${current}". Cannot transition.`;
  }
  if (target === "cancelled") {
    return null; // always allowed
  }

  const ci = phaseIndex(current);
  const ti = phaseIndex(target);

  if (ti < 0 || ci < 0) {
    return `Invalid phase: "${target}".`;
  }

  if (ti <= ci && !force) {
    return `Cannot move backward from "${current}" to "${target}" without --force.`;
  }

  return null; // valid
}

export function transitionTask(id: string, target: Phase, opts: { force?: boolean; actor?: string } = {}): Task {
  const task = loadTask(id);
  if (!task) throw new Error(`Task "${id}" not found.`);

  // Enforce claims: if claimed by a different actor, reject unless --force or transitioning to implement/terminal
  if (task.claimedBy && target !== "implement" && !isTerminal(target) && !opts.force) {
    const actor = resolveActor(opts.actor);
    if (task.claimedBy !== actor) {
      throw new Error(`Task "${id}" is claimed by "${task.claimedBy}". Use --force to override.`);
    }
  }

  const err = validateTransition(task.phase, target, opts.force ?? false);
  if (err) throw new Error(err);

  const db = getDbSync();
  const now = new Date().toISOString();

  db.run(
    "UPDATE tasks SET phase = ?, updated_at = ? WHERE repo = ? AND id = ?",
    [target, now, repo(), id],
  );

  db.run(
    `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
     VALUES (?, ?, 'task', ?, ?, ?)`,
    [repo(), id, target, resolveActor(opts.actor), now],
  );

  if (target === "implement") {
    const branch = gitSafe("rev-parse", "--abbrev-ref", "HEAD");
    const worktree = gitSafe("rev-parse", "--show-toplevel");
    db.run(
      `UPDATE tasks SET claimed_by = ?, claimed_at = ?,
       branch = COALESCE(branch, ?), worktree = COALESCE(worktree, ?)
       WHERE repo = ? AND id = ?`,
      [resolveActor(opts.actor), now, branch, worktree, repo(), id]);
  } else if (isTerminal(target)) {
    db.run("UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE repo = ? AND id = ?",
      [repo(), id]);
  }

  persistDb();

  // Return updated task with newly-unblocked and auto-close info
  touchTask(id);
  const updated = loadTask(id)!;
  if (isTerminal(target)) {
    (updated as any).unblocked = findNewlyUnblocked(id);
    const epicClosed = autoCloseEpic(id);
    if (epicClosed) {
      (updated as any).epicClosed = epicClosed;
    }
  }
  return updated;
}

// ── Batch transitions ──────────────────────────────────────────────

export function transitionBatch(
  ids: string[],
  target: Phase,
  opts?: { force?: boolean; actor?: string },
): { succeeded: Task[]; failed: { id: string; error: string }[] } {
  const succeeded: Task[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const task = transitionTask(id, target, opts);
      succeeded.push(task);
    } catch (e: any) {
      failed.push({ id, error: e.message });
    }
  }
  return { succeeded, failed };
}

// ── Epic phase derivation ───────────────────────────────────────────

export function deriveEpicPhase(epicId: string, repoId?: string): Phase {
  const db = getDbSync();
  const result = db.exec(
    "SELECT phase FROM tasks WHERE repo = ? AND epic = ?",
    [repoId ?? repo(), epicId],
  );

  if (!result[0]?.values.length) {
    // No children — check if epic exists and return its stored phase
    const epic = loadEpic(epicId, repoId);
    return epic?.phase ?? "understand";
  }

  const childPhases: Phase[] = result[0].values.map((row: any[]) => row[0] as Phase);
  const nonTerminal = childPhases.filter((p: Phase) => !isTerminal(p));

  if (nonTerminal.length === 0) {
    return childPhases.every((p: Phase) => p === "cancelled") ? "cancelled" : "done";
  }

  let min = ORDERED_PHASES.length;
  for (const p of nonTerminal) {
    const i = phaseIndex(p);
    if (i >= 0 && i < min) min = i;
  }
  return ORDERED_PHASES[min];
}

// ── Dependency checking ─────────────────────────────────────────────

export function dependenciesMet(task: Task): boolean {
  if (task.dependencies.length === 0) return true;
  const db = getDbSync();
  for (const depId of task.dependencies) {
    const result = db.exec(
      "SELECT phase FROM tasks WHERE repo = ? AND id = ?",
      [repo(), depId],
    );
    if (!result[0]?.values.length) return false;
    if (result[0].values[0][0] !== "done") return false;
  }
  return true;
}

/**
 * Find tasks that became unblocked when completedTaskId finished.
 * Returns tasks whose dependencies all now met and are in non-terminal phase.
 */
export function findNewlyUnblocked(completedTaskId: string): Task[] {
  const completed = loadTask(completedTaskId);
  if (!completed) return [];

  // Find all tasks in the same epic (or all tasks if standalone)
  const tasks = completed.epic ? listTasks({ epic: completed.epic }) : listTasks();

  return tasks.filter((t) => {
    if (isTerminal(t.phase)) return false;
    if (!t.dependencies.includes(completedTaskId)) return false;
    return dependenciesMet(t);
  });
}

/**
 * Auto-close an epic when all its children reach terminal phases.
 * Called from transitionTask() after a task reaches done/cancelled.
 * Returns the epic closure info, or null if no change.
 */
export function autoCloseEpic(taskId: string): { epicId: string; phase: Phase } | null {
  const task = loadTask(taskId);
  if (!task?.epic) return null;

  const derived = deriveEpicPhase(task.epic);
  if (!isTerminal(derived)) return null;

  const epic = loadEpic(task.epic);
  if (!epic || isTerminal(epic.phase)) return null; // already closed

  const db = getDbSync();
  const now = new Date().toISOString();

  db.run(
    "UPDATE epics SET phase = ?, updated_at = ? WHERE repo = ? AND id = ?",
    [derived, now, repo(), task.epic],
  );

  db.run(
    `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
     VALUES (?, ?, 'epic', ?, ?, ?)`,
    [repo(), task.epic, derived, resolveActor(), now],
  );

  persistDb();
  return { epicId: task.epic, phase: derived };
}

// ── Epic progress ───────────────────────────────────────────────────

export interface EpicProgress {
  total: number;
  done: number;
  cancelled: number;
  inProgress: number;
  blocked: number;
  ready: number;
  phases: Partial<Record<Phase, number>>;
}

const IN_PROGRESS_PHASES: Phase[] = ["implement", "verify", "ship"];

export function epicProgress(epicId: string): EpicProgress {
  const tasks = listTasks({ epic: epicId });
  const result: EpicProgress = { total: tasks.length, done: 0, cancelled: 0, inProgress: 0, blocked: 0, ready: 0, phases: {} };
  for (const t of tasks) {
    result.phases[t.phase] = (result.phases[t.phase] ?? 0) + 1;
    if (t.phase === "done") { result.done++; continue; }
    if (t.phase === "cancelled") { result.cancelled++; continue; }
    if (IN_PROGRESS_PHASES.includes(t.phase)) { result.inProgress++; continue; }
    // Non-terminal, non-in-progress: either blocked or ready
    if (dependenciesMet(t)) { result.ready++; } else { result.blocked++; }
  }
  return result;
}

// ── Plan sync (atomic epic+tasks creation) ──────────────────────────

export interface SyncTaskDef {
  ref: string;
  title: string;
  depends: string[];
}

export interface SyncInput {
  title: string;
  description: string;
  tasks: SyncTaskDef[];
}

/**
 * Parse the line-based sync format:
 *   title: Epic title
 *   description: Optional description
 *   ---
 *   ref:1.1 | Step 1.1: Do something
 *   ref:1.2 | Step 1.2: Another thing | depends:1.1
 */
export function parseSyncInput(input: string): SyncInput {
  const text = input.trim();
  if (!text) throw new Error("No input received");

  const parts = text.split(/^---$/m);
  const header = parts[0] ?? "";
  const body = parts.slice(1).join("---");

  let title = "";
  let description = "";
  for (const line of header.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("title:")) title = trimmed.slice(6).trim();
    else if (trimmed.startsWith("description:")) description = trimmed.slice(12).trim();
  }
  if (!title) throw new Error("Missing title");

  const tasks: SyncTaskDef[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const segments = trimmed.split("|").map((s) => s.trim());
    const refSegment = segments[0];
    if (!refSegment?.startsWith("ref:")) continue;

    const ref = refSegment.slice(4).trim();
    const taskTitle = segments[1] ?? "";
    const depends: string[] = [];
    for (const seg of segments.slice(2)) {
      if (seg.startsWith("depends:")) {
        depends.push(...seg.slice(8).split(",").map((s) => s.trim()).filter(Boolean));
      }
    }
    tasks.push({ ref, title: taskTitle, depends });
  }

  return { title, description, tasks };
}

/**
 * Create an epic and tasks from a SyncInput. Returns the epic ID and ref→taskId mapping.
 */
export function syncCreateEpicWithTasks(
  input: SyncInput,
  opts?: { actor?: string },
): { epicId: string; tasks: Record<string, string> } {
  const epic = createEpic({ title: input.title, description: input.description, phase: "design" });
  const refToId: Record<string, string> = {};

  for (const def of input.tasks) {
    const task = createTask({
      title: def.title,
      epic: epic.id,
      phase: "design",
      actor: resolveActor(opts?.actor || "plan-sync"),
    });
    refToId[def.ref] = task.id;
  }

  // Resolve dependency refs to actual task IDs
  for (const def of input.tasks) {
    if (def.depends.length === 0) continue;
    const taskId = refToId[def.ref];
    const task = loadTask(taskId)!;
    task.dependencies = def.depends.map((depRef) => {
      const resolved = refToId[depRef];
      if (!resolved) throw new Error(`Unknown ref "${depRef}"`);
      return resolved;
    });
    saveTask(task);
  }

  return { epicId: epic.id, tasks: refToId };
}

// ── Plan management (versioned, global ~/.glorious/plans/) ──────────

/** Get the latest plan version number for an entity, or 0 if none. */
function latestPlanVersion(id: string): number {
  const dir = path.join(plansDir(), id);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => /^v\d+\.md$/.test(f));
  if (files.length === 0) return 0;
  return Math.max(...files.map(f => parseInt(f.slice(1, -3), 10)));
}

/** Load the latest version of a plan for any entity (epic, task, step). */
export function loadPlan(id: string): string | null {
  const ver = latestPlanVersion(id);
  if (ver === 0) return null;
  return loadPlanVersion(id, ver);
}

/** Load a specific version of a plan. */
export function loadPlanVersion(id: string, version: number): string | null {
  const p = planVersionPath(id, version);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

/** List all plan versions for an entity, sorted ascending. */
export function listPlanVersions(id: string): number[] {
  const dir = path.join(plansDir(), id);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => /^v\d+\.md$/.test(f));
  return files.map(f => parseInt(f.slice(1, -3), 10)).sort((a, b) => a - b);
}

/** Save a new version of a plan. Returns the new version number. */
export function savePlan(id: string, content: string): number {
  const ver = latestPlanVersion(id) + 1;
  const p = planVersionPath(id, ver);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, content);

  // Update the entity's plan field (try task first, then epic)
  const task = loadTask(id);
  if (task) {
    task.plan = p;
    task.planVersion = ver;
    saveTask(task);
  } else {
    const epic = loadEpic(id);
    if (epic) {
      const db = getDbSync();
      db.run(
        "UPDATE epics SET plan = ?, plan_version = ?, updated_at = ? WHERE repo = ? AND id = ?",
        [p, ver, new Date().toISOString(), repo(), id],
      );
      persistDb();
    }
  }

  return ver;
}

/** Save a plan from a file on disk. Returns the new version number. */
export function savePlanFromFile(id: string, filePath: string): number {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const content = fs.readFileSync(filePath, "utf-8");
  return savePlan(id, content);
}

// Backward compat aliases for spec commands still referencing old names
export const loadSpec = loadPlan;
export const saveSpec = (id: string, content: string) => { savePlan(id, content); };
export const saveSpecFromFile = (id: string, filePath: string) => { savePlanFromFile(id, filePath); };

// ── Task lookup helpers ─────────────────────────────────────────────

export function findTaskByWorktree(wtPath: string): Task | null {
  const db = getDbSync();
  const result = db.exec(`${TASK_SELECT} WHERE repo = ? AND worktree = ?`, [repo(), wtPath]);
  if (!result[0]?.values.length) return null;
  const row = result[0].values[0];
  const id = row[0] as string;
  return rowToTask(row, loadTransitions(id), loadChildren(id));
}

export function findTaskByBranch(branch: string): Task | null {
  const db = getDbSync();
  const result = db.exec(`${TASK_SELECT} WHERE repo = ? AND branch = ?`, [repo(), branch]);
  if (!result[0]?.values.length) return null;
  const row = result[0].values[0];
  const id = row[0] as string;
  return rowToTask(row, loadTransitions(id), loadChildren(id));
}

// ── Advanced queries ────────────────────────────────────────────────

/** Find the current task by worktree path first, then by branch name. */
export function findCurrentTask(worktreePath: string, branch: string): Task | null {
  return findTaskByWorktree(worktreePath) ?? findTaskByBranch(branch) ?? null;
}

/** Find the next ready task under an epic (non-terminal, deps met).
 *  With claim option, acquires a file lock and reloads the DB from disk
 *  to prevent concurrent processes from claiming the same task.
 *  If the transition fails (already claimed by another agent), skips to the next task. */
export function findNextTask(epicId: string, opts?: { claim?: string }): Task | null {
  if (opts?.claim) {
    return withDbLock(() => claimNextTask(epicId, opts.claim!));
  }
  return findNextReadyTask(epicId);
}

function findNextReadyTask(epicId: string): Task | null {
  const tasks = listTasks({ epic: epicId });
  for (const task of tasks) {
    if (isTerminal(task.phase)) continue;
    if (!dependenciesMet(task)) continue;
    return task;
  }
  return null;
}

function claimNextTask(epicId: string, actor: string): Task | null {
  const tasks = listTasks({ epic: epicId });
  for (const task of tasks) {
    if (isTerminal(task.phase)) continue;
    if (!dependenciesMet(task)) continue;
    try {
      transitionTask(task.id, "implement", { actor });
      return loadTask(task.id)!;
    } catch {
      continue; // already claimed or invalid transition — try next
    }
  }
  return null;
}

/**
 * Atomically close a task and claim the next ready task in the same epic.
 * Wraps both operations in withDbLock for concurrency safety.
 */
export function closeAndClaimNext(
  taskId: string,
  opts: { actor?: string; force?: boolean } = {},
): { closed: Task; next: Task | null } {
  const task = loadTask(taskId);
  if (!task) throw new Error(`Task "${taskId}" not found.`);
  if (!task.epic) throw new Error(`Task "${taskId}" has no epic. Use transitionTask() directly.`);

  return withDbLock(() => {
    const closed = transitionTask(taskId, "done", opts);
    const next = claimNextTask(task.epic!, resolveActor(opts.actor));
    return { closed, next };
  });
}

/** Find all ready tasks (non-terminal, deps met) across all epics and standalone. */
export function findReadyTasks(opts?: { all?: boolean }): Task[] {
  const tasks = listTasks({ all: opts?.all });
  return tasks.filter((t) => !isTerminal(t.phase) && dependenciesMet(t));
}

/** Aggregate summary counts for the dashboard stats bar. */
export function stateSummary(opts?: { all?: boolean }): {
  totalEpics: number;
  activeEpics: number;
  totalTasks: number;
  activeTasks: number;
  blockedTasks: number;
  readyTasks: number;
  openReviews: number;
} {
  const epics = listEpics({ all: opts?.all });
  const tasks = listTasks({ all: opts?.all });

  const totalEpics = epics.length;
  const activeEpics = epics.filter((e) => {
    const phase = deriveEpicPhase(e.id);
    return !isTerminal(phase);
  }).length;

  const totalTasks = tasks.length;
  const nonTerminal = tasks.filter((t) => !isTerminal(t.phase));
  const activeTasks = nonTerminal.length;
  const readyList = nonTerminal.filter((t) => dependenciesMet(t));
  const readyTasks = readyList.length;
  const blockedTasks = activeTasks - readyTasks;

  // Count open review items
  const db = getDbSync();
  let openQuery: string;
  const params: any[] = [];
  if (opts?.all) {
    openQuery = "SELECT COUNT(*) FROM review_items WHERE status = 'open'";
  } else {
    openQuery = "SELECT COUNT(*) FROM review_items WHERE repo = ? AND status = 'open'";
    params.push(repo());
  }
  const result = db.exec(openQuery, params);
  const openReviews = (result[0]?.values[0]?.[0] as number) || 0;

  return { totalEpics, activeEpics, totalTasks, activeTasks, blockedTasks, readyTasks, openReviews };
}

/** Recent transitions for the activity timeline. */
export function listRecentTransitions(opts?: { all?: boolean; limit?: number }): Array<{
  taskId: string;
  entity: string;
  phase: string;
  actor: string;
  timestamp: string;
}> {
  const db = getDbSync();
  const limit = opts?.limit ?? 20;
  let query: string;
  const params: any[] = [];
  if (opts?.all) {
    query = "SELECT task_id, entity, phase, actor, timestamp FROM transitions ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);
  } else {
    query = "SELECT task_id, entity, phase, actor, timestamp FROM transitions WHERE repo = ? ORDER BY timestamp DESC LIMIT ?";
    params.push(repo(), limit);
  }
  const result = db.exec(query, params);
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => ({
    taskId: row[0] as string,
    entity: row[1] as string,
    phase: row[2] as string,
    actor: row[3] as string,
    timestamp: row[4] as string,
  }));
}

/** Load a task with optional plan content inlining and field projection. */
export function loadTaskFull(
  id: string,
  opts?: { withSpec?: boolean; fields?: string[] },
): Record<string, unknown> | null {
  const task = loadTask(id);
  if (!task) return null;

  let result: Record<string, unknown> = { ...task };

  if (opts?.withSpec && task.plan) {
    const content = loadPlan(id);
    if (content) result.planContent = content;
  }

  if (opts?.fields) {
    const projected: Record<string, unknown> = {};
    for (const field of opts.fields) {
      if (field in result) projected[field] = result[field];
    }
    return projected;
  }

  return result;
}

// ── Task notes ─────────────────────────────────────────────────────

export interface TaskNote {
  id: string;
  taskId: string;
  body: string;
  actor: string;
  createdAt: string;
}

function nextNoteId(): string {
  const db = getDbSync();
  const result = db.exec(
    "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) FROM task_notes WHERE repo = ?",
    [repo()],
  );
  const max = result[0]?.values[0]?.[0] ?? 0;
  return `n${(max || 0) + 1}`;
}

export function addTaskNote(opts: { taskId: string; body: string; actor?: string }): TaskNote {
  const db = getDbSync();
  const id = nextNoteId();
  const now = new Date().toISOString();
  const actor = resolveActor(opts.actor);

  db.run(
    `INSERT INTO task_notes (repo, id, task_id, body, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [repo(), id, opts.taskId, opts.body, actor, now],
  );
  persistDb();

  return { id, taskId: opts.taskId, body: opts.body, actor, createdAt: now };
}

export function loadTaskNotes(taskId: string): TaskNote[] {
  const db = getDbSync();
  const result = db.exec(
    "SELECT id, task_id, body, actor, created_at FROM task_notes WHERE repo = ? AND task_id = ? ORDER BY created_at, id",
    [repo(), taskId],
  );
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => ({
    id: row[0] as string,
    taskId: row[1] as string,
    body: row[2] as string,
    actor: row[3] as string,
    createdAt: row[4] as string,
  }));
}

// ── Review types ────────────────────────────────────────────────────

export interface Review {
  id: string;
  taskId: string | null;
  epicId: string | null;
  source: string;
  commitSha: string;
  prNumber: number | null;
  summary: string | null;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  reviewId: string;
  severity: string | null;
  agents: string[];
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  body: string;
  impact: string | null;
  suggestedFix: string | null;
  status: string;
  resolution: string | null;
  resolutionSha: string | null;
  prCommentId: number | null;
  resolvedAt: string | null;
}

export interface ReviewSummaryResult {
  total: number;
  open: number;
  fixed: number;
  pushedBack: number;
  wontFix: number;
  acknowledged: number;
  bySeverity: Record<string, Record<string, number>>;
}

// ── Review CRUD ─────────────────────────────────────────────────────

function nextReviewId(): string {
  const db = getDbSync();
  const result = db.exec(
    "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) FROM reviews WHERE repo = ?",
    [repo()],
  );
  const max = result[0]?.values[0]?.[0] ?? 0;
  return `r${(max || 0) + 1}`;
}

function nextReviewItemId(): string {
  const db = getDbSync();
  const result = db.exec(
    "SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) FROM review_items WHERE repo = ?",
    [repo()],
  );
  const max = result[0]?.values[0]?.[0] ?? 0;
  return `ri${(max || 0) + 1}`;
}

export function createReview(opts: {
  taskId?: string;
  epicId?: string;
  source: string;
  commitSha: string;
  prNumber?: number;
  summary?: string;
}): Review {
  const db = getDbSync();
  const id = nextReviewId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO reviews (repo, id, task_id, epic_id, source, commit_sha, pr_number, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repo(), id,
      opts.taskId ?? null, opts.epicId ?? null,
      opts.source, opts.commitSha,
      opts.prNumber ?? null, opts.summary ?? null,
      now,
    ],
  );
  persistDb();

  return {
    id,
    taskId: opts.taskId ?? null,
    epicId: opts.epicId ?? null,
    source: opts.source,
    commitSha: opts.commitSha,
    prNumber: opts.prNumber ?? null,
    summary: opts.summary ?? null,
    createdAt: now,
  };
}

export function addReviewItem(opts: {
  reviewId: string;
  body: string;
  severity?: string;
  agents?: string[];
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  impact?: string;
  suggestedFix?: string;
  prCommentId?: number;
}): ReviewItem {
  const db = getDbSync();
  const id = nextReviewItemId();

  db.run(
    `INSERT INTO review_items (repo, id, review_id, severity, agents, file_path, line_start, line_end, body, impact, suggested_fix, status, pr_comment_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    [
      repo(), id, opts.reviewId,
      opts.severity ?? null,
      JSON.stringify(opts.agents ?? []),
      opts.filePath ?? null,
      opts.lineStart ?? null, opts.lineEnd ?? null,
      opts.body,
      opts.impact ?? null, opts.suggestedFix ?? null,
      opts.prCommentId ?? null,
    ],
  );
  persistDb();

  return {
    id,
    reviewId: opts.reviewId,
    severity: opts.severity ?? null,
    agents: opts.agents ?? [],
    filePath: opts.filePath ?? null,
    lineStart: opts.lineStart ?? null,
    lineEnd: opts.lineEnd ?? null,
    body: opts.body,
    impact: opts.impact ?? null,
    suggestedFix: opts.suggestedFix ?? null,
    status: "open",
    resolution: null,
    resolutionSha: null,
    prCommentId: opts.prCommentId ?? null,
    resolvedAt: null,
  };
}

export function resolveReviewItem(
  itemId: string,
  opts: { status: string; resolution: string; commitSha?: string },
): ReviewItem {
  const db = getDbSync();
  const now = new Date().toISOString();

  db.run(
    `UPDATE review_items SET status = ?, resolution = ?, resolution_sha = ?, resolved_at = ?
     WHERE repo = ? AND id = ?`,
    [opts.status, opts.resolution, opts.commitSha ?? null, now, repo(), itemId],
  );
  persistDb();

  // Reload and return
  const result = db.exec(
    `SELECT id, review_id, severity, agents, file_path, line_start, line_end, body, impact, suggested_fix, status, resolution, resolution_sha, pr_comment_id, resolved_at
     FROM review_items WHERE repo = ? AND id = ?`,
    [repo(), itemId],
  );
  const row = result[0]?.values[0];
  if (!row) throw new Error(`Review item "${itemId}" not found.`);
  return rowToReviewItem(row);
}

function rowToReviewItem(row: any[]): ReviewItem {
  return {
    id: row[0] as string,
    reviewId: row[1] as string,
    severity: row[2] as string | null,
    agents: JSON.parse((row[3] as string) || "[]"),
    filePath: row[4] as string | null,
    lineStart: row[5] as number | null,
    lineEnd: row[6] as number | null,
    body: row[7] as string,
    impact: row[8] as string | null,
    suggestedFix: row[9] as string | null,
    status: row[10] as string,
    resolution: row[11] as string | null,
    resolutionSha: row[12] as string | null,
    prCommentId: row[13] as number | null,
    resolvedAt: row[14] as string | null,
  };
}

export function listReviewItems(opts?: {
  taskId?: string;
  status?: string;
  severity?: string;
  reviewId?: string;
}): ReviewItem[] {
  const db = getDbSync();
  let query = `SELECT ri.id, ri.review_id, ri.severity, ri.agents, ri.file_path, ri.line_start, ri.line_end, ri.body, ri.impact, ri.suggested_fix, ri.status, ri.resolution, ri.resolution_sha, ri.pr_comment_id, ri.resolved_at
    FROM review_items ri`;
  const params: any[] = [];
  const conditions: string[] = ["ri.repo = ?"];
  params.push(repo());

  if (opts?.taskId) {
    query += " JOIN reviews r ON ri.repo = r.repo AND ri.review_id = r.id";
    conditions.push("r.task_id = ?");
    params.push(opts.taskId);
  }

  if (opts?.status) {
    conditions.push("ri.status = ?");
    params.push(opts.status);
  }

  if (opts?.severity) {
    conditions.push("ri.severity = ?");
    params.push(opts.severity);
  }

  if (opts?.reviewId) {
    conditions.push("ri.review_id = ?");
    params.push(opts.reviewId);
  }

  query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY ri.id";

  const result = db.exec(query, params);
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => rowToReviewItem(row));
}

export function reviewSummary(opts?: { taskId?: string; repoId?: string }): ReviewSummaryResult {
  const db = getDbSync();

  // SQL GROUP BY for counts — avoids loading full review item payloads
  let query = `
    SELECT ri.severity, ri.status, COUNT(*) as cnt
    FROM review_items ri
    JOIN reviews r ON ri.repo = r.repo AND ri.review_id = r.id
    WHERE ri.repo = ?`;
  const params: any[] = [opts?.repoId ?? repo()];

  if (opts?.taskId) {
    query += " AND r.task_id = ?";
    params.push(opts.taskId);
  }

  query += " GROUP BY ri.severity, ri.status";

  const result = db.exec(query, params);

  const summary: ReviewSummaryResult = {
    total: 0,
    open: 0,
    fixed: 0,
    pushedBack: 0,
    wontFix: 0,
    acknowledged: 0,
    bySeverity: {},
  };

  if (!result[0]?.values.length) return summary;

  for (const row of result[0].values) {
    const sev = (row[0] as string) ?? "UNSET";
    const status = row[1] as string;
    const cnt = row[2] as number;

    summary.total += cnt;

    if (!summary.bySeverity[sev]) summary.bySeverity[sev] = {};
    summary.bySeverity[sev][status] = cnt;

    switch (status) {
      case "open": summary.open += cnt; break;
      case "fixed": summary.fixed += cnt; break;
      case "pushed_back": summary.pushedBack += cnt; break;
      case "wont_fix": summary.wontFix += cnt; break;
      case "acknowledged": summary.acknowledged += cnt; break;
    }
  }

  return summary;
}

