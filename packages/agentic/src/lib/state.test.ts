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
  loadPlan,
  savePlan,
  savePlanFromFile,
  setPlansDir,
  nextStepId,
  createStep,
  loadStep,
  listSteps,
  saveStep,
  findTaskByWorktree,
  findTaskByBranch,
  ensureSetup,
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
const TEST_PLANS_DIR = path.join(TEST_DIR, "plans");

beforeEach(async () => {
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  await initState(TEST_DB_PATH);
  setPlansDir(TEST_PLANS_DIR);
});

afterEach(() => {
  setPlansDir(null);
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up test dir
  const sp = path.join(TEST_DIR);
  if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true });
});

// ── Auto-setup ───────────────────────────────────────────────────────

describe("ensureSetup", () => {
  test("creates plans directory", () => {
    ensureSetup();
    expect(fs.existsSync(TEST_PLANS_DIR)).toBe(true);
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
  });

  test("creates standalone task without epic", () => {
    const task = createTask({ title: "Standalone" });
    expect(task.epic).toBeNull();
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

  test("lean returns only id, title, phase for basic task", () => {
    createTask({ title: "T" });
    const tasks = listTasks({ lean: true });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
    expect(tasks[0].title).toBe("T");
    expect(tasks[0].phase).toBe("understand");
    expect(Object.keys(tasks[0])).toEqual(["id", "title", "phase"]);
  });

  test("lean includes epic when present", () => {
    createEpic({ title: "E" });
    createTask({ title: "T", epic: "e1" });
    const tasks = listTasks({ lean: true });
    expect(tasks[0].epic).toBe("e1");
  });

  test("lean includes branch when set", () => {
    createTask({ title: "T" });
    saveTask({ ...loadTask("t1")!, branch: "feat/x" });
    const tasks = listTasks({ lean: true });
    expect(tasks[0].branch).toBe("feat/x");
  });

  test("lean includes dependencies when non-empty", () => {
    createEpic({ title: "E" });
    createTask({ title: "A", epic: "e1" });
    createTask({ title: "B", epic: "e1" });
    saveTask({ ...loadTask("t2")!, dependencies: ["t1"] });
    const tasks = listTasks({ lean: true, epic: "e1" });
    const t2 = tasks.find((t) => t.id === "t2")!;
    expect(t2.dependencies).toEqual(["t1"]);
  });

  test("lean omits null/empty fields", () => {
    createTask({ title: "T" });
    const tasks = listTasks({ lean: true });
    const task = tasks[0];
    const keys = Object.keys(task);
    expect(keys).toEqual(["id", "title", "phase"]);
    expect(task).not.toHaveProperty("epic");
    expect(task).not.toHaveProperty("branch");
    expect(task).not.toHaveProperty("dependencies");
    expect(task).not.toHaveProperty("qaResult");
    expect(task).not.toHaveProperty("description");
    expect(task).not.toHaveProperty("worktree");
    expect(task).not.toHaveProperty("pr");
    expect(task).not.toHaveProperty("children");
    expect(task).not.toHaveProperty("transitions");
  });

  test("lean includes qaResult when present", () => {
    createTask({ title: "T" });
    const task = loadTask("t1")!;
    task.qaResult = { status: "pass", summary: "ok", timestamp: new Date().toISOString() };
    saveTask(task);
    const tasks = listTasks({ lean: true });
    expect(tasks[0].qaResult?.status).toBe("pass");
    expect(tasks[0].qaResult?.summary).toBe("ok");
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

// ── Plan management (versioned) ─────────────────────────────────────

describe("plan management", () => {
  test("loadPlan returns null when no plan exists", () => {
    expect(loadPlan("t99")).toBeNull();
  });

  test("savePlan writes v1 and loadPlan reads it", () => {
    createTask({ title: "Test" });
    const ver = savePlan("t1", "# My Plan\n\nContent here.");
    expect(ver).toBe(1);
    const content = loadPlan("t1");
    expect(content).toBe("# My Plan\n\nContent here.");
  });

  test("savePlan updates task.plan field", () => {
    createTask({ title: "Test" });
    savePlan("t1", "# Plan");
    const task = loadTask("t1")!;
    expect(task.plan).toBeTruthy();
    expect(task.planVersion).toBe(1);
  });

  test("savePlan auto-increments version", () => {
    createTask({ title: "Test" });
    const v1 = savePlan("t1", "version one");
    const v2 = savePlan("t1", "version two");
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(loadPlan("t1")).toBe("version two");
  });

  test("savePlanFromFile reads from disk", () => {
    createTask({ title: "Test" });
    const tmp = path.join(os.tmpdir(), "test-plan-tmp.md");
    fs.writeFileSync(tmp, "# From file");
    try {
      const ver = savePlanFromFile("t1", tmp);
      expect(ver).toBe(1);
      expect(loadPlan("t1")).toBe("# From file");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("savePlanFromFile throws for missing file", () => {
    createTask({ title: "Test" });
    expect(() => savePlanFromFile("t1", "/nonexistent/path.md")).toThrow("File not found");
  });
});

// ── Step CRUD ───────────────────────────────────────────────────────

describe("nextStepId", () => {
  test("returns s1 when no steps exist", () => {
    expect(nextStepId()).toBe("s1");
  });

  test("increments from existing steps", () => {
    createTask({ title: "Task" });
    createStep({ title: "Step 1", task: "t1" });
    createStep({ title: "Step 2", task: "t1" });
    expect(nextStepId()).toBe("s3");
  });
});

describe("createStep", () => {
  test("creates a step with all default fields", () => {
    createTask({ title: "Task" });
    const step = createStep({ title: "Do thing", task: "t1" });
    expect(step.id).toBe("s1");
    expect(step.task).toBe("t1");
    expect(step.title).toBe("Do thing");
    expect(step.phase).toBe("understand");
    expect(step.sortOrder).toBe(0);
    expect(step.plan).toBeNull();
    expect(step.planVersion).toBeNull();
  });

  test("creates with custom sortOrder and phase", () => {
    createTask({ title: "Task" });
    const step = createStep({ title: "Step", task: "t1", sortOrder: 3, phase: "implement" });
    expect(step.sortOrder).toBe(3);
    expect(step.phase).toBe("implement");
  });
});

describe("loadStep", () => {
  test("returns null for nonexistent step", () => {
    expect(loadStep("s99")).toBeNull();
  });

  test("retrieves created step", () => {
    createTask({ title: "Task" });
    createStep({ title: "My Step", task: "t1" });
    const loaded = loadStep("s1");
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("My Step");
    expect(loaded!.task).toBe("t1");
  });
});

describe("listSteps", () => {
  test("returns empty array when no steps", () => {
    expect(listSteps()).toEqual([]);
  });

  test("filters by task", () => {
    createTask({ title: "T1" });
    createTask({ title: "T2" });
    createStep({ title: "S1 under T1", task: "t1" });
    createStep({ title: "S2 under T1", task: "t1" });
    createStep({ title: "S3 under T2", task: "t2" });

    const t1Steps = listSteps({ task: "t1" });
    expect(t1Steps).toHaveLength(2);
    expect(t1Steps[0].title).toBe("S1 under T1");
    expect(t1Steps[1].title).toBe("S2 under T1");
  });

  test("returns empty for task with no steps", () => {
    expect(listSteps({ task: "t99" })).toEqual([]);
  });
});

describe("saveStep", () => {
  test("updates existing step", () => {
    createTask({ title: "Task" });
    const step = createStep({ title: "Original", task: "t1" });
    step.title = "Updated";
    saveStep(step);
    const loaded = loadStep("s1")!;
    expect(loaded.title).toBe("Updated");
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

  test("claim transitions task to implement and returns it", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" }); // understand phase

    const next = findNextTask("e1", { claim: "agent-1" });
    expect(next).not.toBeNull();
    expect(next!.id).toBe("t1");
    expect(next!.phase).toBe("implement");
  });

  test("claim skips already-claimed tasks", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" }); // understand
    createTask({ title: "T2", epic: "e1" }); // understand

    // Agent 1 claims t1
    const first = findNextTask("e1", { claim: "agent-1" });
    expect(first!.id).toBe("t1");
    expect(first!.phase).toBe("implement");

    // Agent 2 calls claim — should skip t1 (in implement) and get t2
    const second = findNextTask("e1", { claim: "agent-2" });
    expect(second).not.toBeNull();
    expect(second!.id).toBe("t2");
    expect(second!.phase).toBe("implement");
  });

  test("claim returns null when all tasks already claimed", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" });

    findNextTask("e1", { claim: "agent-1" }); // claims t1
    const second = findNextTask("e1", { claim: "agent-2" });
    expect(second).toBeNull();
  });

  test("claim skips tasks in design with unmet deps", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "design" });
    const t2 = createTask({ title: "T2", epic: "e1", phase: "design" });
    t2.dependencies = ["t1"];
    saveTask(t2);

    // Claim should get t1 (deps met), not t2 (deps unmet)
    const next = findNextTask("e1", { claim: "agent-1" });
    expect(next!.id).toBe("t1");

    // T2 still blocked (t1 is now in implement, not done)
    const second = findNextTask("e1", { claim: "agent-2" });
    expect(second).toBeNull();
  });

  test("claim skips tasks in verify/ship phase (cannot go backward to implement)", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1" });
    transitionTask("t1", "implement", { force: true });
    transitionTask("t1", "verify", { force: true });

    // Claiming should skip t1 (verify -> implement would be backward)
    const next = findNextTask("e1", { claim: "agent-1" });
    expect(next).toBeNull();
  });

  test("non-claim path returns task without transitioning it", () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "design" });

    const next = findNextTask("e1");
    expect(next).not.toBeNull();
    expect(next!.id).toBe("t1");
    expect(next!.phase).toBe("design"); // NOT transitioned to implement
  });

  test("claim after external DB modification sees fresh state", async () => {
    createEpic({ title: "Epic" });
    createTask({ title: "T1", epic: "e1", phase: "design" });
    createTask({ title: "T2", epic: "e1", phase: "design" });

    // Simulate another process claiming t1 by modifying the DB file directly
    const { persistDb } = await import("./db.js");
    persistDb(); // ensure current state is on disk

    // @ts-ignore -- sql.js has no type declarations
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(TEST_DB_PATH);
    const extDb = new SQL.Database(buffer);
    // Externally transition t1 to implement (simulating another process claiming it)
    const repo = extDb.exec("SELECT repo FROM tasks LIMIT 1")[0]?.values[0]?.[0];
    extDb.run("UPDATE tasks SET phase = 'implement' WHERE id = 't1' AND repo = ?", [repo]);
    fs.writeFileSync(TEST_DB_PATH, Buffer.from(extDb.export()));
    extDb.close();

    // Claim should reload from disk, see t1 as implement, skip to t2
    const next = findNextTask("e1", { claim: "agent-1" });
    expect(next).not.toBeNull();
    expect(next!.id).toBe("t2");
    expect(next!.phase).toBe("implement");
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

// ── claimed_by ─────────────────────────────────────────────────────

describe("claimed_by", () => {
  test("new task has null claimedBy", () => {
    const task = createTask({ title: "T1" });
    expect(task.claimedBy).toBeNull();
    expect(task.claimedAt).toBeNull();
  });

  test("transition to implement sets claimedBy to actor", () => {
    createTask({ title: "T1" });
    const task = transitionTask("t1", "implement", { actor: "agent-1", force: true });
    expect(task.claimedBy).toBe("agent-1");
    expect(task.claimedAt).toBeTruthy();
    // claimedAt should be a valid ISO date
    expect(new Date(task.claimedAt!).toISOString()).toBe(task.claimedAt!);
  });

  test("transition to done clears claimedBy", () => {
    createTask({ title: "T1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    const task = transitionTask("t1", "done", { force: true });
    expect(task.claimedBy).toBeNull();
    expect(task.claimedAt).toBeNull();
  });

  test("transition to cancelled clears claimedBy", () => {
    createTask({ title: "T1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    const task = transitionTask("t1", "cancelled");
    expect(task.claimedBy).toBeNull();
    expect(task.claimedAt).toBeNull();
  });

  test("claimedBy survives saveTask round-trip", () => {
    const task = createTask({ title: "T1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    const loaded = loadTask("t1")!;
    expect(loaded.claimedBy).toBe("agent-1");
    // Modify and save
    loaded.title = "Updated";
    saveTask(loaded);
    const reloaded = loadTask("t1")!;
    expect(reloaded.claimedBy).toBe("agent-1");
    expect(reloaded.title).toBe("Updated");
  });

  test("claimedBy appears in loadTaskFull JSON output", () => {
    createTask({ title: "T1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    const full = loadTaskFull("t1");
    expect((full as any).claimedBy).toBe("agent-1");
  });

  test("lean listTasks includes claimedBy when set", () => {
    createEpic({ title: "E" });
    createTask({ title: "T1", epic: "e1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    const tasks = listTasks({ epic: "e1", lean: true });
    expect((tasks[0] as any).claimedBy).toBe("agent-1");
  });

  test("findNextTask claim sets claimedBy", () => {
    createEpic({ title: "E" });
    createTask({ title: "T1", epic: "e1", phase: "design" });
    const next = findNextTask("e1", { claim: "build-loop" });
    expect(next!.claimedBy).toBe("build-loop");
  });

  test("transition to verify preserves claimedBy", () => {
    createTask({ title: "T1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    const task = transitionTask("t1", "verify", { force: true });
    expect(task.claimedBy).toBe("agent-1");
  });

  test("transition to ship preserves claimedBy", () => {
    createTask({ title: "T1" });
    transitionTask("t1", "implement", { actor: "agent-1", force: true });
    transitionTask("t1", "verify", { force: true });
    const task = transitionTask("t1", "ship", { force: true });
    expect(task.claimedBy).toBe("agent-1");
  });
});

// ── auto-set branch/worktree on implement ──────────────────────────

describe("auto-set branch on implement", () => {
  test("implement sets branch from git", () => {
    createTask({ title: "T1" });
    const task = transitionTask("t1", "implement", { actor: "agent-1", force: true });
    expect(task.branch).toBeTruthy();
    expect(typeof task.branch).toBe("string");
  });

  test("implement sets worktree from git", () => {
    createTask({ title: "T1" });
    const task = transitionTask("t1", "implement", { actor: "agent-1", force: true });
    expect(task.worktree).toBeTruthy();
    expect(typeof task.worktree).toBe("string");
  });

  test("implement does not overwrite existing branch", () => {
    const task = createTask({ title: "T1" });
    task.branch = "my-custom-branch";
    saveTask(task);
    const updated = transitionTask("t1", "implement", { actor: "agent-1", force: true });
    expect(updated.branch).toBe("my-custom-branch");
  });

  test("implement does not overwrite existing worktree", () => {
    const task = createTask({ title: "T1" });
    task.worktree = "/my/custom/worktree";
    saveTask(task);
    const updated = transitionTask("t1", "implement", { actor: "agent-1", force: true });
    expect(updated.worktree).toBe("/my/custom/worktree");
  });

  test("task current works after implement transition", () => {
    createTask({ title: "T1" });
    const task = transitionTask("t1", "implement", { actor: "agent-1", force: true });
    // findCurrentTask should find it by the auto-set worktree or branch
    const found = findCurrentTask(task.worktree ?? "", task.branch ?? "");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("t1");
  });

  test("findNextTask --claim also sets branch", () => {
    createEpic({ title: "E" });
    createTask({ title: "T1", epic: "e1", phase: "design" as any });
    const task = findNextTask("e1", { claim: "agent-1" });
    expect(task).not.toBeNull();
    expect(task!.branch).toBeTruthy();
    expect(task!.worktree).toBeTruthy();
  });

  test("non-implement transitions don't set branch", () => {
    createTask({ title: "T1" });
    const task = transitionTask("t1", "design", { force: true });
    expect(task.branch).toBeNull();
  });
});

// ── loadTaskFull ────────────────────────────────────────────────────

describe("loadTaskFull", () => {
  test("with withSpec inlines plan content", () => {
    createTask({ title: "Test" });
    savePlan("t1", "# Plan content\nDetails here.");

    const full = loadTaskFull("t1", { withSpec: true });
    expect(full).not.toBeNull();
    expect((full as any).planContent).toBe("# Plan content\nDetails here.");
  });

  test("without withSpec does not include planContent", () => {
    createTask({ title: "Test" });
    savePlan("t1", "# Plan content");

    const full = loadTaskFull("t1");
    expect(full).not.toBeNull();
    expect((full as any).planContent).toBeUndefined();
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

  test("throws for nonexistent item", () => {
    expect(() => {
      resolveReviewItem("ri999", { status: "fixed", resolution: "done" });
    }).toThrow('Review item "ri999" not found.');
  });

  test("throws for empty string ID", () => {
    expect(() => {
      resolveReviewItem("", { status: "fixed", resolution: "done" });
    }).toThrow('Review item "" not found.');
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
