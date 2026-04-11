import fs from "node:fs";
import path from "node:path";
import { gitRoot } from "./git.js";
import { getDb, getDbSync, persistDb, getRepo, closeDb, resetDb, resetRepoCache, DB_PATH } from "./db.js";

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
  spec: string | null;
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
  spec: string | null;
  qaResult: QAResult | null;
  createdAt: string;
  updatedAt: string;
  children: string[];
  transitions: Transition[];
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

// ── Paths (specs remain in filesystem) ──────────────────────────────

function specsDir(): string {
  return path.join(gitRoot(), ".glorious", "specs");
}

function specPath(id: string): string {
  return path.join(specsDir(), `${id}.md`);
}

// ── Auto-setup ──────────────────────────────────────────────────────

/** Ensure specs directory and gitignore are configured. */
export function ensureSetup(): void {
  const sp = specsDir();
  if (!fs.existsSync(sp)) fs.mkdirSync(sp, { recursive: true });

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

// ── Epic CRUD ───────────────────────────────────────────────────────

export function createEpic(opts: {
  title: string;
  description?: string;
  phase?: Phase;
  spec?: string;
}): Epic {
  const db = getDbSync();
  const id = nextEpicId();
  const now = new Date().toISOString();
  const phase = opts.phase ?? "understand";

  db.run(
    `INSERT INTO epics (repo, id, title, description, phase, spec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [repo(), id, opts.title, opts.description ?? "", phase, opts.spec ?? null, now, now],
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
    spec: opts.spec ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadEpic(id: string): Epic | null {
  const db = getDbSync();
  const result = db.exec(
    "SELECT id, title, description, phase, spec, created_at, updated_at FROM epics WHERE repo = ? AND id = ?",
    [repo(), id],
  );
  if (!result[0]?.values.length) return null;
  const row = result[0].values[0];
  return {
    id: row[0] as string,
    title: row[1] as string,
    description: row[2] as string,
    phase: row[3] as Phase,
    spec: row[4] as string | null,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  };
}

export function listEpics(): Epic[] {
  const db = getDbSync();
  const result = db.exec(
    "SELECT id, title, description, phase, spec, created_at, updated_at FROM epics WHERE repo = ? ORDER BY id",
    [repo()],
  );
  if (!result[0]?.values.length) return [];
  return result[0].values.map((row: any[]) => ({
    id: row[0] as string,
    title: row[1] as string,
    description: row[2] as string,
    phase: row[3] as Phase,
    spec: row[4] as string | null,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  }));
}

// ── Task CRUD ───────────────────────────────────────────────────────

function rowToTask(row: any[], transitions: Transition[], children: string[]): Task {
  const qaStatus = row[12] as string | null;
  const qaSummary = row[13] as string | null;
  const qaTimestamp = row[14] as string | null;

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
    spec: row[10] as string | null,
    createdAt: row[11] as string,
    updatedAt: row[15] as string,
    qaResult: qaStatus ? { status: qaStatus as "pass" | "fail", summary: qaSummary!, timestamp: qaTimestamp! } : null,
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

const TASK_SELECT = `SELECT id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, spec, created_at, qa_status, qa_summary, qa_timestamp, updated_at FROM tasks`;

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
    `INSERT OR REPLACE INTO tasks (repo, id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, spec, qa_status, qa_summary, qa_timestamp, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      task.spec,
      task.qaResult?.status ?? null,
      task.qaResult?.summary ?? null,
      task.qaResult?.timestamp ?? null,
      task.createdAt,
      now,
    ],
  );
  persistDb();
  task.updatedAt = now;
}

export function listTasks(opts?: { epic?: string; all?: boolean; lean?: boolean }): Task[] {
  const db = getDbSync();
  let query: string;
  const params: any[] = [];

  if (opts?.all) {
    query = `${TASK_SELECT} WHERE 1=1`;
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

  return result[0].values.map((row: any[]) => {
    const id = row[0] as string;
    if (opts?.lean) {
      // Compact object: only non-null, non-empty fields. Skip transitions/children queries.
      const compact: Record<string, any> = { id, title: row[2] as string, phase: row[4] as Phase };
      const epic = row[1] as string | null;
      if (epic) compact.epic = epic;
      const branch = row[6] as string | null;
      if (branch) compact.branch = branch;
      const deps = JSON.parse((row[5] as string) || "[]");
      if (deps.length > 0) compact.dependencies = deps;
      const qaStatus = row[12] as string | null;
      if (qaStatus) compact.qaResult = { status: qaStatus, summary: row[13] as string };
      return compact as Task;
    }
    const transitions = loadTransitions(id, "task");
    const children = loadChildren(id);
    return rowToTask(row, transitions, children);
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
    `INSERT INTO tasks (repo, id, epic, title, description, phase, dependencies, branch, worktree, pr, external_id, spec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    [repo(), id, epic, opts.title, opts.description ?? "", phase, now, now],
  );

  // Record initial transition
  db.run(
    `INSERT INTO transitions (repo, task_id, entity, phase, actor, timestamp)
     VALUES (?, ?, 'task', ?, ?, ?)`,
    [repo(), id, phase, opts.actor ?? "cli", now],
  );

  persistDb();

  return {
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
    spec: null,
    qaResult: null,
    createdAt: now,
    updatedAt: now,
    children: [],
    transitions: [{ phase, timestamp: now, actor: opts.actor ?? "cli" }],
  };
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
    [repo(), id, target, opts.actor ?? "cli", now],
  );

  persistDb();

  // Return updated task
  return loadTask(id)!;
}

// ── Epic phase derivation ───────────────────────────────────────────

export function deriveEpicPhase(epicId: string): Phase {
  const db = getDbSync();
  const result = db.exec(
    "SELECT phase FROM tasks WHERE repo = ? AND epic = ?",
    [repo(), epicId],
  );

  if (!result[0]?.values.length) {
    // No children — check if epic exists and return its stored phase
    const epic = loadEpic(epicId);
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

// ── Spec management ─────────────────────────────────────────────────

export function loadSpec(taskId: string): string | null {
  const p = specPath(taskId);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

export function saveSpec(taskId: string, content: string): void {
  const sp = specsDir();
  if (!fs.existsSync(sp)) fs.mkdirSync(sp, { recursive: true });
  const p = specPath(taskId);
  fs.writeFileSync(p, content);

  // Update the task's spec field
  const task = loadTask(taskId);
  if (task) {
    const rel = `.glorious/specs/${taskId}.md`;
    if (task.spec !== rel) {
      task.spec = rel;
      saveTask(task);
    }
  }
}

export function saveSpecFromFile(taskId: string, filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const content = fs.readFileSync(filePath, "utf-8");
  saveSpec(taskId, content);
}

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

/** Find the next ready task under an epic (non-terminal, deps met). */
export function findNextTask(epicId: string): Task | null {
  const tasks = listTasks({ epic: epicId });
  for (const task of tasks) {
    if (isTerminal(task.phase)) continue;
    if (dependenciesMet(task)) return task;
  }
  return null;
}

/** Find all ready tasks (non-terminal, deps met) across all epics and standalone. */
export function findReadyTasks(opts?: { all?: boolean }): Task[] {
  const tasks = listTasks({ all: opts?.all });
  return tasks.filter((t) => !isTerminal(t.phase) && dependenciesMet(t));
}

/** Load a task with optional spec content inlining and field projection. */
export function loadTaskFull(
  id: string,
  opts?: { withSpec?: boolean; fields?: string[] },
): Record<string, unknown> | null {
  const task = loadTask(id);
  if (!task) return null;

  let result: Record<string, unknown> = { ...task };

  if (opts?.withSpec && task.spec) {
    const content = loadSpec(id);
    if (content) result.specContent = content;
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

export function reviewSummary(opts?: { taskId?: string }): ReviewSummaryResult {
  const db = getDbSync();

  // SQL GROUP BY for counts — avoids loading full review item payloads
  let query = `
    SELECT ri.severity, ri.status, COUNT(*) as cnt
    FROM review_items ri
    JOIN reviews r ON ri.repo = r.repo AND ri.review_id = r.id
    WHERE ri.repo = ?`;
  const params: any[] = [repo()];

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

