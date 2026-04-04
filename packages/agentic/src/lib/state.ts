import fs from "node:fs";
import path from "node:path";
import { gitRoot } from "./git.js";

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

export interface Task {
  id: string;
  title: string;
  description: string;
  phase: Phase;
  parent: string | null;
  children: string[];
  dependencies: string[];
  branch: string | null;
  worktree: string | null;
  pr: string | null;
  externalId: string | null;
  spec: string | null;
  qaResult: QAResult | null;
  transitions: Transition[];
  createdAt: string;
}

export interface PipelineState {
  taskId: string;
  currentPhase: Phase;
  completedSkills: string[];
  skippedSkills: string[];
  nextSkill: string | null;
  startedAt: string;
}

// ── Paths ────────────────────────────────────────────────────────────

function stateDir(): string {
  return path.join(gitRoot(), ".glorious", "state");
}

function specsDir(): string {
  return path.join(gitRoot(), ".glorious", "specs");
}

function taskPath(id: string): string {
  return path.join(stateDir(), `${id}.json`);
}

function pipelinePath(id: string): string {
  return path.join(stateDir(), `${id}.pipeline.json`);
}

function specPath(id: string): string {
  return path.join(specsDir(), `${id}.md`);
}

// ── Auto-setup (R-25, R-26) ─────────────────────────────────────────

function ensureDirs(): void {
  const sd = stateDir();
  const sp = specsDir();
  if (!fs.existsSync(sd)) fs.mkdirSync(sd, { recursive: true });
  if (!fs.existsSync(sp)) fs.mkdirSync(sp, { recursive: true });
}

/** Add .glorious/state/ to .gitignore if not already present. */
function ensureGitignore(): void {
  const root = gitRoot();
  const gi = path.join(root, ".gitignore");
  const entry = ".glorious/state/";

  if (fs.existsSync(gi)) {
    const content = fs.readFileSync(gi, "utf-8");
    if (content.includes(entry)) return;
    fs.appendFileSync(gi, `\n# glorious local state (per-engineer, not shared)\n${entry}\n`);
  } else {
    fs.writeFileSync(gi, `# glorious local state (per-engineer, not shared)\n${entry}\n`);
  }
}

/** Ensure .glorious/state/ and .glorious/specs/ exist, and .gitignore is set. */
export function ensureSetup(): void {
  ensureDirs();
  ensureGitignore();
}

// ── ID generation ────────────────────────────────────────────────────

/** Generate next top-level task ID (t1, t2, ...) */
export function nextTaskId(): string {
  const dir = stateDir();
  if (!fs.existsSync(dir)) return "t1";

  let max = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^t(\d+)\.json$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `t${max + 1}`;
}

/** Generate next workstream ID under a parent (t1-1, t1-2, ...) */
export function nextWorkstreamId(parentId: string): string {
  const dir = stateDir();
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^${parentId}-(\\d+)\\.json$`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return `${parentId}-${max + 1}`;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function loadTask(id: string): Task | null {
  const p = taskPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function saveTask(task: Task): void {
  ensureSetup();
  fs.writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2) + "\n");
}

export function listTasks(): Task[] {
  const dir = stateDir();
  if (!fs.existsSync(dir)) return [];

  const tasks: Task[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json") && !f.includes(".pipeline.")) {
      tasks.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    }
  }
  return tasks;
}

export function createTask(opts: {
  title: string;
  description?: string;
  parent?: string;
  phase?: Phase;
  actor?: string;
}): Task {
  const id = opts.parent ? nextWorkstreamId(opts.parent) : nextTaskId();
  const phase = opts.phase ?? "understand";
  const task: Task = {
    id,
    title: opts.title,
    description: opts.description ?? "",
    phase,
    parent: opts.parent ?? null,
    children: [],
    dependencies: [],
    branch: null,
    worktree: null,
    pr: null,
    externalId: null,
    spec: null,
    qaResult: null,
    transitions: [{ phase, timestamp: new Date().toISOString(), actor: opts.actor ?? "cli" }],
    createdAt: new Date().toISOString(),
  };
  saveTask(task);

  // If this is a workstream, add it to the parent's children array
  if (opts.parent) {
    const parent = loadTask(opts.parent);
    if (parent) {
      parent.children.push(id);
      saveTask(parent);
    }
  }

  return task;
}

// ── Phase transitions (R-02, R-06) ──────────────────────────────────

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

  if (task.children.length > 0) {
    throw new Error(`Task "${id}" is an epic. Transition its children instead.`);
  }

  const err = validateTransition(task.phase, target, opts.force ?? false);
  if (err) throw new Error(err);

  task.phase = target;
  task.transitions.push({
    phase: target,
    timestamp: new Date().toISOString(),
    actor: opts.actor ?? "cli",
  });
  saveTask(task);
  return task;
}

// ── Epic phase derivation (R-08) ────────────────────────────────────

export function deriveEpicPhase(epicId: string): Phase {
  const epic = loadTask(epicId);
  if (!epic || epic.children.length === 0) return epic?.phase ?? "understand";

  const childPhases = epic.children.map((cid) => {
    const child = loadTask(cid);
    return child?.phase ?? "understand";
  });

  const nonTerminal = childPhases.filter((p) => !isTerminal(p));
  if (nonTerminal.length === 0) {
    // All children terminal
    return childPhases.every((p) => p === "cancelled") ? "cancelled" : "done";
  }

  // Minimum phase among non-terminal children
  let min = ORDERED_PHASES.length;
  for (const p of nonTerminal) {
    const i = phaseIndex(p);
    if (i >= 0 && i < min) min = i;
  }
  return ORDERED_PHASES[min];
}

// ── Dependency checking (BR-02) ─────────────────────────────────────

export function dependenciesMet(task: Task): boolean {
  if (task.dependencies.length === 0) return true;
  return task.dependencies.every((depId) => {
    const dep = loadTask(depId);
    return dep && dep.phase === "done";
  });
}

// ── Spec management ─────────────────────────────────────────────────

export function loadSpec(taskId: string): string | null {
  const p = specPath(taskId);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8");
}

export function saveSpec(taskId: string, content: string): void {
  ensureSetup();
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

// ── Pipeline state ──────────────────────────────────────────────────

export function loadPipeline(taskId: string): PipelineState | null {
  const p = pipelinePath(taskId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function savePipeline(state: PipelineState): void {
  ensureSetup();
  fs.writeFileSync(pipelinePath(state.taskId), JSON.stringify(state, null, 2) + "\n");
}

// ── Task lookup helpers ─────────────────────────────────────────────

/** Find the task associated with the current worktree path. */
export function findTaskByWorktree(wtPath: string): Task | null {
  for (const task of listTasks()) {
    if (task.worktree === wtPath) return task;
  }
  return null;
}

/** Find the task associated with the current git branch. */
export function findTaskByBranch(branch: string): Task | null {
  for (const task of listTasks()) {
    if (task.branch === branch) return task;
  }
  return null;
}
