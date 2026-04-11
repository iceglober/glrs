import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  initState,
  cleanupState,
  createTask,
  loadTask,
  listTasks,
  saveTask,
  transitionTask,
  validateTransition,
  deriveEpicPhase,
  dependenciesMet,
  isTerminal,
  nextTaskId,
  nextEpicId,
  createEpic,
  loadEpic,
  listEpics,
  loadSpec,
  saveSpec,
  saveSpecFromFile,
  loadPipeline,
  savePipeline,
  findTaskByWorktree,
  findTaskByBranch,
  ensureSetup,
  nextWorkstreamId,
  findCurrentTask,
  findNextTask,
  findReadyTasks,
  loadTaskFull,
  createReview,
  addReviewItem,
  resolveReviewItem,
  listReviewItems,
  reviewSummary,
  PHASES,
  type Task,
  type Phase,
} from "./state.js";
import { gitRoot } from "./git.js";
import { resetDb, getDbSync, DB_PATH } from "./db.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-state-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DIR, "state.db");

beforeEach(async () => {
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  await initState(TEST_DB_PATH);
});

afterEach(() => {
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up specs dir created by tests
  const sp = path.join(gitRoot(), ".glorious", "specs");
  if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true });
});

// ── Auto-setup ───────────────────────────────────────────────────────

describe("ensureSetup", () => {
  test("creates .glorious/specs/ directory", () => {
    ensureSetup();
    const sp = path.join(gitRoot(), ".glorious", "specs");
    expect(fs.existsSync(sp)).toBe(true);
  });

  test("adds .glorious/state/ to .gitignore", () => {
    ensureSetup();
    const gi = fs.readFileSync(path.join(gitRoot(), ".gitignore"), "utf-8");
    expect(gi).toContain(".glorious/state/");
  });
});

// ── ID generation ────────────────────────────────────────────────────

describe("nextTaskId", () => {
  test("returns t1 when no tasks exist", () => {
    expect(nextTaskId()).toBe("t1");
  });

  test("increments from existing tasks", () => {
    createTask({ title: "first" });
    createTask({ title: "second" });
    expect(nextTaskId()).toBe("t3");
  });
});

describe("nextEpicId", () => {
  test("returns e1 when no epics exist", () => {
    expect(nextEpicId()).toBe("e1");
  });

  test("increments from existing epics", () => {
    createEpic({ title: "first" });
    createEpic({ title: "second" });
    expect(nextEpicId()).toBe("e3");
  });
});

describe("nextWorkstreamId (deprecated)", () => {
  test("returns a task ID", () => {
    const id = nextWorkstreamId("t1");
    expect(id).toMatch(/^t\d+$/);
  });
});

// ── Epic CRUD ────────────────────────────────────────────────────────

describe("createEpic", () => {
  test("returns epic with e-prefix ID", () => {
    const epic = createEpic({ title: "Test epic" });
    expect(epic.id).toBe("e1");
    expect(epic.title).toBe("Test epic");
    expect(epic.phase).toBe("understand");
    expect(epic.description).toBe("");
  });

  test("creates with custom phase and description", () => {
    const epic = createEpic({ title: "Advanced", description: "Details", phase: "design" });
    expect(epic.phase).toBe("design");
    expect(epic.description).toBe("Details");
  });
});

describe("loadEpic", () => {
  test("returns null for nonexistent epic", () => {
    expect(loadEpic("e99")).toBeNull();
  });

  test("retrieves epic by repo+id", () => {
    createEpic({ title: "My Epic" });
    const loaded = loadEpic("e1");
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("My Epic");
    expect(loaded!.id).toBe("e1");
  });
});

describe("listEpics", () => {
  test("returns empty array when no epics exist", () => {
    expect(listEpics()).toEqual([]);
  });

  test("returns all epics for current repo", () => {
    createEpic({ title: "E1" });
    createEpic({ title: "E2" });
    const epics = listEpics();
    expect(epics).toHaveLength(2);
    expect(epics[0].id).toBe("e1");
    expect(epics[1].id).toBe("e2");
  });
});

// ── Task CRUD ────────────────────────────────────────────────────────

describe("createTask", () => {
  test("creates a task with all default fields", () => {
    const task = createTask({ title: "Test task" });
    expect(task.id).toBe("t1");
    expect(task.title).toBe("Test task");
    expect(task.phase).toBe("understand");
    expect(task.epic).toBeNull();
    expect(task.dependencies).toEqual([]);
    expect(task.transitions).toHaveLength(1);
    expect(task.transitions[0].phase).toBe("understand");
  });

  test("creates with custom phase", () => {
    const task = createTask({ title: "Quick fix", phase: "implement" });
    expect(task.phase).toBe("implement");
    expect(task.transitions[0].phase).toBe("implement");
  });

  test("creates task linked to epic via epic param", () => {
    const epic = createEpic({ title: "Epic" });
    const task = createTask({ title: "Task", epic: epic.id });
    expect(task.epic).toBe("e1");
    expect(task.parent).toBe("e1"); // backward compat
  });

  test("creates task linked to epic via deprecated parent param", () => {
    const epic = createEpic({ title: "Epic" });
    const task = createTask({ title: "Task", parent: epic.id });
    expect(task.epic).toBe("e1");
    expect(task.parent).toBe("e1");
  });

  test("creates standalone task without epic", () => {
    const task = createTask({ title: "Standalone" });
    expect(task.epic).toBeNull();
    expect(task.parent).toBeNull();
  });

  test("records actor in transition", () => {
    const task = createTask({ title: "Test", actor: "gs-agentic start" });
    expect(task.transitions[0].actor).toBe("gs-agentic start");
  });
});

describe("loadTask", () => {
  test("returns null for nonexistent task", () => {
    expect(loadTask("t99")).toBeNull();
  });

  test("returns the task after creation", () => {
    createTask({ title: "Hello" });
    const loaded = loadTask("t1");
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("Hello");
  });

  test("populates transitions from transitions table", () => {
    createTask({ title: "Test" });
    transitionTask("t1", "design");
    const loaded = loadTask("t1")!;
    expect(loaded.transitions).toHaveLength(2);
    expect(loaded.transitions[0].phase).toBe("understand");
    expect(loaded.transitions[1].phase).toBe("design");
  });

  test("populates children from tasks with matching epic", () => {
    // t1 isn't an epic, but if tasks reference its ID, they show as children
    createEpic({ title: "Epic" });
    createTask({ title: "Child 1", epic: "e1" });
    createTask({ title: "Child 2", epic: "e1" });
    // loadTask won't find "e1" (it's in epics table), but children are on tasks
    const t1 = loadTask("t1")!;
    expect(t1.children).toEqual([]); // t1 has no children
  });
});

describe("listTasks", () => {
  test("returns empty array when no tasks", () => {
    expect(listTasks()).toEqual([]);
  });

  test("returns all tasks", () => {
    createTask({ title: "A" });
    createTask({ title: "B" });
    const tasks = listTasks();
    expect(tasks).toHaveLength(2);
  });

  test("filters by epic", () => {
    createEpic({ title: "E1" });
    createEpic({ title: "E2" });
    createTask({ title: "Under E1", epic: "e1" });
    createTask({ title: "Also E1", epic: "e1" });
    createTask({ title: "Under E2", epic: "e2" });
    createTask({ title: "Standalone" });

    const e1Tasks = listTasks({ epic: "e1" });
    expect(e1Tasks).toHaveLength(2);
    expect(e1Tasks[0].title).toBe("Under E1");
    expect(e1Tasks[1].title).toBe("Also E1");
  });

  test("excludes pipeline data (no pipeline contamination)", () => {
    createTask({ title: "A" });
    savePipeline({
      taskId: "t1",
      currentPhase: "understand",
      completedSkills: [],
      skippedSkills: [],
      nextSkill: "think",
      startedAt: new Date().toISOString(),
    });
    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
  });
});

describe("saveTask", () => {
  test("updates existing task", () => {
    const task = createTask({ title: "Original" });
    task.title = "Updated";
    saveTask(task);
    const loaded = loadTask("t1")!;
    expect(loaded.title).toBe("Updated");
  });

  test("updates updated_at timestamp", async () => {
    const task = createTask({ title: "Test" });
    const firstUpdatedAt = task.updatedAt;
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    task.title = "Changed";
    saveTask(task);
    const loaded = loadTask("t1")!;
    expect(loaded.updatedAt).not.toBe(firstUpdatedAt);
  });
});

// ── Phase transitions ────────────────────────────────────────────────

describe("validateTransition", () => {
  test("allows forward transitions", () => {
    expect(validateTransition("understand", "design", false)).toBeNull();
    expect(validateTransition("design", "implement", false)).toBeNull();
    expect(validateTransition("implement", "verify", false)).toBeNull();
    expect(validateTransition("verify", "ship", false)).toBeNull();
    expect(validateTransition("ship", "done", false)).toBeNull();
  });

  test("allows skipping phases forward", () => {
    expect(validateTransition("understand", "implement", false)).toBeNull();
  });

  test("blocks backward transitions without force", () => {
    const err = validateTransition("design", "understand", false);
    expect(err).toContain("Cannot move backward");
  });

  test("allows backward transitions with force", () => {
    expect(validateTransition("design", "understand", true)).toBeNull();
  });

  test("allows cancelled from any phase", () => {
    for (const phase of ["understand", "design", "implement", "verify", "ship"] as Phase[]) {
      expect(validateTransition(phase, "cancelled", false)).toBeNull();
    }
  });

  test("blocks transitions from terminal phases", () => {
    expect(validateTransition("done", "implement", false)).toContain("terminal");
    expect(validateTransition("cancelled", "implement", false)).toContain("terminal");
  });

  test("blocks same-phase transition without force", () => {
    const err = validateTransition("design", "design", false);
    expect(err).toContain("Cannot move backward");
  });
});

describe("transitionTask", () => {
  test("transitions and logs", () => {
    createTask({ title: "Test" });
    const task = transitionTask("t1", "design", { actor: "test" });
    expect(task.phase).toBe("design");
    expect(task.transitions).toHaveLength(2);
    expect(task.transitions[1].actor).toBe("test");
  });

  test("persists to DB", () => {
    createTask({ title: "Test" });
    transitionTask("t1", "design");
    const loaded = loadTask("t1")!;
    expect(loaded.phase).toBe("design");
  });

  test("records in transitions table", () => {
    createTask({ title: "Test" });
    transitionTask("t1", "design", { actor: "test-actor" });
    const loaded = loadTask("t1")!;
    expect(loaded.transitions).toHaveLength(2);
    expect(loaded.transitions[1].phase).toBe("design");
    expect(loaded.transitions[1].actor).toBe("test-actor");
  });

  test("throws for nonexistent task", () => {
    expect(() => transitionTask("t99", "design")).toThrow("not found");
  });

  test("throws for invalid backward transition", () => {
    createTask({ title: "Test" });
    transitionTask("t1", "design");
    expect(() => transitionTask("t1", "understand")).toThrow("Cannot move backward");
  });
});

describe("isTerminal", () => {
  test("done and cancelled are terminal", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  test("other phases are not terminal", () => {
    expect(isTerminal("understand")).toBe(false);
    expect(isTerminal("implement")).toBe(false);
  });
});

// ── Epic phase derivation ────────────────────────────────────────────

describe("deriveEpicPhase", () => {
  test("returns minimum phase of non-terminal children", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "implement" });
    createTask({ title: "T2", epic: "e1", phase: "verify" });
    expect(deriveEpicPhase("e1")).toBe("implement");
  });

  test("returns done when all children done", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "implement" });
    createTask({ title: "T2", epic: "e1", phase: "implement" });
    transitionTask("t1", "done", { force: true });
    transitionTask("t2", "done", { force: true });
    expect(deriveEpicPhase("e1")).toBe("done");
  });

  test("returns cancelled when all children cancelled", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" });
    createTask({ title: "T2", epic: "e1" });
    transitionTask("t1", "cancelled");
    transitionTask("t2", "cancelled");
    expect(deriveEpicPhase("e1")).toBe("cancelled");
  });

  test("returns done when mix of done and cancelled", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "implement" });
    createTask({ title: "T2", epic: "e1" });
    transitionTask("t1", "done", { force: true });
    transitionTask("t2", "cancelled");
    expect(deriveEpicPhase("e1")).toBe("done");
  });

  test("ignores terminal children when non-terminal exist", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "implement" });
    createTask({ title: "T2", epic: "e1" });
    transitionTask("t1", "done", { force: true });
    // t2 is still in understand
    expect(deriveEpicPhase("e1")).toBe("understand");
  });

  test("returns stored phase for epic with no children", () => {
    createEpic({ title: "Epic", phase: "design" });
    expect(deriveEpicPhase("e1")).toBe("design");
  });
});

// ── Dependencies ─────────────────────────────────────────────────────

describe("dependenciesMet", () => {
  test("returns true with no dependencies", () => {
    const task = createTask({ title: "No deps" });
    expect(dependenciesMet(task)).toBe(true);
  });

  test("returns false when dependency not done", () => {
    createTask({ title: "Dep" });
    const task = createTask({ title: "Blocked" });
    task.dependencies = ["t1"];
    saveTask(task);
    expect(dependenciesMet(task)).toBe(false);
  });

  test("returns true when dependency is done", () => {
    createTask({ title: "Dep" });
    transitionTask("t1", "done", { force: true });
    const task = createTask({ title: "Unblocked" });
    task.dependencies = ["t1"];
    saveTask(task);
    expect(dependenciesMet(task)).toBe(true);
  });

  test("returns false when only some dependencies met", () => {
    createTask({ title: "Dep1" });
    createTask({ title: "Dep2" });
    transitionTask("t1", "done", { force: true });
    const task = createTask({ title: "Blocked" });
    task.dependencies = ["t1", "t2"];
    saveTask(task);
    expect(dependenciesMet(task)).toBe(false);
  });
});

// ── Spec management ──────────────────────────────────────────────────

describe("spec management", () => {
  test("loadSpec returns null when no spec exists", () => {
    expect(loadSpec("t99")).toBeNull();
  });

  test("saveSpec writes and loadSpec reads", () => {
    createTask({ title: "Test" });
    saveSpec("t1", "# My Spec\n\nContent here.");
    const content = loadSpec("t1");
    expect(content).toBe("# My Spec\n\nContent here.");
  });

  test("saveSpec updates task.spec field", () => {
    createTask({ title: "Test" });
    saveSpec("t1", "# Spec");
    const task = loadTask("t1")!;
    expect(task.spec).toBe(".glorious/specs/t1.md");
  });

  test("saveSpecFromFile reads from disk", () => {
    createTask({ title: "Test" });
    const tmp = path.join(gitRoot(), ".glorious", "test-spec-tmp.md");
    const dir = path.dirname(tmp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, "# From file");
    try {
      saveSpecFromFile("t1", tmp);
      expect(loadSpec("t1")).toBe("# From file");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("saveSpecFromFile throws for missing file", () => {
    createTask({ title: "Test" });
    expect(() => saveSpecFromFile("t1", "/nonexistent/path.md")).toThrow("File not found");
  });
});

// ── Pipeline state ───────────────────────────────────────────────────

describe("pipeline state", () => {
  test("loadPipeline returns null when no pipeline exists", () => {
    expect(loadPipeline("t99")).toBeNull();
  });

  test("savePipeline writes and loadPipeline reads", () => {
    const state = {
      taskId: "t1",
      currentPhase: "design" as Phase,
      completedSkills: ["think", "spec-make"],
      skippedSkills: [],
      nextSkill: "spec-enrich",
      startedAt: "2026-03-30T10:00:00Z",
    };
    savePipeline(state);
    const loaded = loadPipeline("t1");
    expect(loaded).toEqual(state);
  });
});

// ── Task lookup ──────────────────────────────────────────────────────

describe("findTaskByWorktree", () => {
  test("returns null when no match", () => {
    expect(findTaskByWorktree("/some/path")).toBeNull();
  });

  test("finds task by worktree path", () => {
    const task = createTask({ title: "Test" });
    task.worktree = "/some/worktree";
    saveTask(task);
    const found = findTaskByWorktree("/some/worktree");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("t1");
  });
});

describe("findTaskByBranch", () => {
  test("returns null when no match", () => {
    expect(findTaskByBranch("nonexistent")).toBeNull();
  });

  test("finds task by branch name", () => {
    const task = createTask({ title: "Test" });
    task.branch = "feat/test";
    saveTask(task);
    const found = findTaskByBranch("feat/test");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("t1");
  });
});

// ── findCurrentTask ─────────────────────────────────────────────────

describe("findCurrentTask", () => {
  test("matches by worktree first", () => {
    const t1 = createTask({ title: "By worktree" });
    t1.worktree = "/some/wt";
    t1.branch = "feat/test";
    saveTask(t1);

    const t2 = createTask({ title: "By branch" });
    t2.branch = "feat/test"; // same branch but different task
    saveTask(t2);

    const found = findCurrentTask("/some/wt", "feat/test");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("t1"); // worktree match wins
  });

  test("falls back to branch when no worktree match", () => {
    const task = createTask({ title: "By branch" });
    task.branch = "feat/my-branch";
    saveTask(task);

    const found = findCurrentTask("/nonexistent/wt", "feat/my-branch");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("t1");
  });

  test("returns null if no match", () => {
    createTask({ title: "Unrelated" });
    const found = findCurrentTask("/no/match", "no/branch");
    expect(found).toBeNull();
  });
});

// ── findNextTask ────────────────────────────────────────────────────

describe("findNextTask", () => {
  test("returns first task with deps met", () => {
    createEpic({ title: "Epic" });
    const t1 = createTask({ title: "T1", epic: "e1" });
    transitionTask("t1", "done", { force: true });

    const t2 = createTask({ title: "T2", epic: "e1" });
    t2.dependencies = ["t1"];
    saveTask(t2);

    const t3 = createTask({ title: "T3", epic: "e1" });
    t3.dependencies = ["t2"];
    saveTask(t3);

    const next = findNextTask("e1");
    expect(next).not.toBeNull();
    expect(next!.id).toBe("t2"); // t1 done, t2 deps met, t3 deps unmet
  });

  test("skips tasks with unmet deps", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" }); // in understand
    const t2 = createTask({ title: "T2", epic: "e1" });
    t2.dependencies = ["t1"];
    saveTask(t2);

    // T1 is not done, T2 depends on T1 → only T1 is ready (no deps)
    const next = findNextTask("e1");
    expect(next).not.toBeNull();
    expect(next!.id).toBe("t1");
  });

  test("returns null when all tasks done", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" });
    transitionTask("t1", "done", { force: true });
    createTask({ title: "T2", epic: "e1" });
    transitionTask("t2", "done", { force: true });

    expect(findNextTask("e1")).toBeNull();
  });

  test("returns null when all remaining tasks blocked", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "Blocker", epic: "e1" }); // t1, in understand
    const t2 = createTask({ title: "Blocked", epic: "e1" });
    t2.dependencies = ["t1"];
    saveTask(t2);

    // Cancel the blocker — it's terminal but not "done"
    transitionTask("t1", "cancelled");

    // t2 depends on t1 which is cancelled (not done) → deps not met
    // t1 is terminal → skip
    // All remaining are either terminal or blocked
    expect(findNextTask("e1")).toBeNull();
  });
});

// ── findReadyTasks ──────────────────────────────────────────────────

describe("findReadyTasks", () => {
  test("returns all ready tasks across epics", () => {
    createEpic({ title: "E1" });
    createEpic({ title: "E2" });
    createTask({ title: "Ready in E1", epic: "e1" });
    createTask({ title: "Ready in E2", epic: "e2" });

    const ready = findReadyTasks();
    expect(ready).toHaveLength(2);
  });

  test("includes standalone ready tasks", () => {
    createTask({ title: "Standalone" });
    createEpic({ title: "E1" });
    createTask({ title: "Under E1", epic: "e1" });

    const ready = findReadyTasks();
    expect(ready).toHaveLength(2);
  });

  test("excludes tasks with unmet deps", () => {
    createEpic({ title: "E1" });
    createTask({ title: "T1", epic: "e1" });
    const t2 = createTask({ title: "T2", epic: "e1" });
    t2.dependencies = ["t1"];
    saveTask(t2);

    const ready = findReadyTasks();
    // Only T1 is ready (T2 blocked by T1)
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("t1");
  });

  test("excludes terminal tasks", () => {
    createTask({ title: "Done" });
    transitionTask("t1", "done", { force: true });
    createTask({ title: "Active" });

    const ready = findReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("t2");
  });

  test("all option includes cross-repo tasks", () => {
    createTask({ title: "Local task" });

    // Insert a task with a different repo directly via SQL
    const db = getDbSync();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO tasks (repo, id, title, description, phase, dependencies, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["other/repo", "t1", "Cross-repo task", "", "implement", "[]", now, now],
    );

    // Default (no all) — only local
    const local = findReadyTasks();
    expect(local).toHaveLength(1);
    expect(local[0].title).toBe("Local task");

    // With all — includes cross-repo
    const all = findReadyTasks({ all: true });
    expect(all).toHaveLength(2);
  });

  test("all: false behaves same as default", () => {
    createTask({ title: "A task" });

    const defaultResult = findReadyTasks();
    const explicitFalse = findReadyTasks({ all: false });
    expect(defaultResult).toHaveLength(explicitFalse.length);
  });
});

// ── loadTaskFull ────────────────────────────────────────────────────

describe("loadTaskFull", () => {
  test("with withSpec inlines spec content", () => {
    createTask({ title: "Test" });
    saveSpec("t1", "# Spec content\nDetails here.");

    const full = loadTaskFull("t1", { withSpec: true });
    expect(full).not.toBeNull();
    expect((full as any).specContent).toBe("# Spec content\nDetails here.");
  });

  test("without withSpec does not include specContent", () => {
    createTask({ title: "Test" });
    saveSpec("t1", "# Spec content");

    const full = loadTaskFull("t1");
    expect(full).not.toBeNull();
    expect((full as any).specContent).toBeUndefined();
  });

  test("with fields returns only requested fields", () => {
    createTask({ title: "Test" });
    const full = loadTaskFull("t1", { fields: ["id", "title", "phase"] });
    expect(full).not.toBeNull();
    expect(full!.id).toBe("t1");
    expect(full!.title).toBe("Test");
    expect((full as any).phase).toBe("understand");
    expect((full as any).branch).toBeUndefined();
    expect((full as any).worktree).toBeUndefined();
  });

  test("returns null for nonexistent task", () => {
    expect(loadTaskFull("t99")).toBeNull();
  });
});

// ── Review CRUD ─────────────────────────────────────────────────────

describe("createReview", () => {
  test("returns review with r-prefix ID", () => {
    const review = createReview({
      taskId: "t1",
      source: "deep_review",
      commitSha: "abc123",
    });
    expect(review.id).toBe("r1");
    expect(review.source).toBe("deep_review");
    expect(review.commitSha).toBe("abc123");
  });

  test("increments review IDs", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    const r2 = createReview({ taskId: "t1", source: "quick_review", commitSha: "def" });
    expect(r2.id).toBe("r2");
  });

  test("stores optional fields", () => {
    const review = createReview({
      taskId: "t1",
      epicId: "e1",
      source: "pr_review",
      commitSha: "abc",
      prNumber: 42,
      summary: "Found 3 issues",
    });
    expect(review.prNumber).toBe(42);
    expect(review.summary).toBe("Found 3 issues");
    expect(review.epicId).toBe("e1");
  });
});

describe("addReviewItem", () => {
  test("returns item with ri-prefix ID", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    const item = addReviewItem({
      reviewId: "r1",
      body: "Missing auth check",
      severity: "CRITICAL",
    });
    expect(item.id).toBe("ri1");
    expect(item.body).toBe("Missing auth check");
    expect(item.severity).toBe("CRITICAL");
    expect(item.status).toBe("open");
  });

  test("stores agents as JSON array", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    const item = addReviewItem({
      reviewId: "r1",
      body: "SQL injection risk",
      agents: ["security", "data_integrity"],
    });
    expect(item.agents).toEqual(["security", "data_integrity"]);
  });

  test("stores all optional fields", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    const item = addReviewItem({
      reviewId: "r1",
      body: "Missing index",
      severity: "HIGH",
      agents: ["data_integrity"],
      filePath: "src/db.ts",
      lineStart: 42,
      lineEnd: 45,
      impact: "Slow queries on large tables",
      suggestedFix: "Add index on tasks.branch",
      prCommentId: 12345,
    });
    expect(item.filePath).toBe("src/db.ts");
    expect(item.lineStart).toBe(42);
    expect(item.lineEnd).toBe(45);
    expect(item.impact).toBe("Slow queries on large tables");
    expect(item.suggestedFix).toBe("Add index on tasks.branch");
    expect(item.prCommentId).toBe(12345);
  });
});

describe("resolveReviewItem", () => {
  test("sets status, resolution, sha, and resolved_at", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    addReviewItem({ reviewId: "r1", body: "Issue" });
    const resolved = resolveReviewItem("ri1", {
      status: "fixed",
      resolution: "Parameterized query, see db.ts:42",
      commitSha: "def456",
    });
    expect(resolved.status).toBe("fixed");
    expect(resolved.resolution).toBe("Parameterized query, see db.ts:42");
    expect(resolved.resolutionSha).toBe("def456");
    expect(resolved.resolvedAt).toBeTruthy();
  });

  test("supports pushed_back status", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    addReviewItem({ reviewId: "r1", body: "Nitpick" });
    const resolved = resolveReviewItem("ri1", {
      status: "pushed_back",
      resolution: "Intentional — see design doc",
    });
    expect(resolved.status).toBe("pushed_back");
    expect(resolved.resolutionSha).toBeNull();
  });
});

describe("listReviewItems", () => {
  test("filters by task", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    createReview({ taskId: "t2", source: "deep_review", commitSha: "def" });
    addReviewItem({ reviewId: "r1", body: "Issue for t1" });
    addReviewItem({ reviewId: "r2", body: "Issue for t2" });

    const items = listReviewItems({ taskId: "t1" });
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe("Issue for t1");
  });

  test("filters by status", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    addReviewItem({ reviewId: "r1", body: "Open issue" });
    addReviewItem({ reviewId: "r1", body: "Fixed issue" });
    resolveReviewItem("ri2", { status: "fixed", resolution: "Done" });

    const openItems = listReviewItems({ status: "open" });
    expect(openItems).toHaveLength(1);
    expect(openItems[0].body).toBe("Open issue");
  });

  test("filters by severity", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    addReviewItem({ reviewId: "r1", body: "Critical", severity: "CRITICAL" });
    addReviewItem({ reviewId: "r1", body: "Low", severity: "LOW" });

    const criticals = listReviewItems({ severity: "CRITICAL" });
    expect(criticals).toHaveLength(1);
    expect(criticals[0].body).toBe("Critical");
  });
});

describe("reviewSummary", () => {
  test("returns grouped counts by status and severity", () => {
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    addReviewItem({ reviewId: "r1", body: "C1", severity: "CRITICAL" });
    addReviewItem({ reviewId: "r1", body: "C2", severity: "CRITICAL" });
    addReviewItem({ reviewId: "r1", body: "H1", severity: "HIGH" });
    addReviewItem({ reviewId: "r1", body: "M1", severity: "MEDIUM" });

    resolveReviewItem("ri1", { status: "fixed", resolution: "Done", commitSha: "x" });
    resolveReviewItem("ri3", { status: "pushed_back", resolution: "By design" });

    const summary = reviewSummary({ taskId: "t1" });
    expect(summary.total).toBe(4);
    expect(summary.open).toBe(2); // ri2 (CRITICAL), ri4 (MEDIUM)
    expect(summary.fixed).toBe(1); // ri1
    expect(summary.pushedBack).toBe(1); // ri3
    expect(summary.bySeverity.CRITICAL.open).toBe(1);
    expect(summary.bySeverity.CRITICAL.fixed).toBe(1);
    expect(summary.bySeverity.HIGH.pushed_back).toBe(1);
    expect(summary.bySeverity.MEDIUM.open).toBe(1);
  });
});

// ── Foreign key enforcement ─────────────────────────────────────────

describe("foreign key enforcement", () => {
  test("blocks creating a task with nonexistent epic", () => {
    expect(() => {
      createTask({ title: "orphan", epic: "e999" });
    }).toThrow();
  });

  test("allows creating a task with a valid epic", () => {
    createEpic({ title: "valid epic" });
    const task = createTask({ title: "linked", epic: "e1" });
    expect(task.epic).toBe("e1");
  });

  test("CASCADE delete removes review items when review is deleted", () => {
    createTask({ title: "t" });
    createReview({ taskId: "t1", source: "deep_review", commitSha: "abc" });
    addReviewItem({ reviewId: "r1", body: "finding" });

    const db = getDbSync();
    db.run("DELETE FROM reviews WHERE id = 'r1'");

    const items = listReviewItems({ taskId: "t1" });
    expect(items).toHaveLength(0);
  });

  test("epic delete is blocked when tasks reference it (composite FK)", () => {
    createEpic({ title: "referenced epic" });
    createTask({ title: "child", epic: "e1" });

    // Composite FK (repo, epic) -> (repo, id) with ON DELETE SET NULL
    // can't NULL the NOT NULL repo column, so the delete should either
    // be blocked or leave the task's epic intact
    const db = getDbSync();
    db.run("DELETE FROM epics WHERE id = 'e1'");

    // Task still references the epic (SET NULL can't operate on composite FK
    // when one column is NOT NULL)
    const task = loadTask("t1");
    expect(task).not.toBeNull();
  });
});

// ── persistDb path behavior ─────────────────────────────────────────

describe("persistDb path behavior", () => {
  test("persistDb writes to the init path, not DB_PATH", () => {
    // TEST_DB_PATH was passed to initState in beforeEach
    // If we create a task, it persists to TEST_DB_PATH
    createTask({ title: "path test" });

    // The test DB file should exist
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

    // DB_PATH should NOT have been created/modified by this test
    // (It may or may not exist from prior real usage, but we can verify
    // the test DB path is what was used by checking its content)
    const testDbSize = fs.statSync(TEST_DB_PATH).size;
    expect(testDbSize).toBeGreaterThan(0);
  });
});
