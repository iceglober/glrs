import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
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
  nextWorkstreamId,
  loadSpec,
  saveSpec,
  saveSpecFromFile,
  loadPipeline,
  savePipeline,
  findTaskByWorktree,
  findTaskByBranch,
  ensureSetup,
  PHASES,
  type Task,
  type Phase,
} from "./state.js";
import { gitRoot } from "./git.js";

const stateDir = () => path.join(gitRoot(), ".glorious", "state");
const specsDir = () => path.join(gitRoot(), ".glorious", "specs");

function cleanState() {
  const sd = stateDir();
  const sp = specsDir();
  if (fs.existsSync(sd)) fs.rmSync(sd, { recursive: true });
  if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true });
}

beforeEach(() => {
  cleanState();
});

afterAll(() => {
  cleanState();
});

// ── Auto-setup ───────────────────────────────────────────────────────

describe("ensureSetup", () => {
  test("creates .glorious/state/ and .glorious/specs/ directories", () => {
    ensureSetup();
    expect(fs.existsSync(stateDir())).toBe(true);
    expect(fs.existsSync(specsDir())).toBe(true);
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

  test("skips workstream files", () => {
    createTask({ title: "parent" });
    createTask({ title: "child", parent: "t1" });
    // t1-1.json exists but nextTaskId should return t2, not t1-2
    expect(nextTaskId()).toBe("t2");
  });
});

describe("nextWorkstreamId", () => {
  test("returns parentId-1 for first workstream", () => {
    createTask({ title: "parent" });
    expect(nextWorkstreamId("t1")).toBe("t1-1");
  });

  test("increments from existing workstreams", () => {
    createTask({ title: "parent" });
    createTask({ title: "ws1", parent: "t1" });
    createTask({ title: "ws2", parent: "t1" });
    expect(nextWorkstreamId("t1")).toBe("t1-3");
  });
});

// ── CRUD ─────────────────────────────────────────────────────────────

describe("createTask", () => {
  test("creates a task with all default fields", () => {
    const task = createTask({ title: "Test task" });
    expect(task.id).toBe("t1");
    expect(task.title).toBe("Test task");
    expect(task.phase).toBe("understand");
    expect(task.parent).toBeNull();
    expect(task.children).toEqual([]);
    expect(task.dependencies).toEqual([]);
    expect(task.transitions).toHaveLength(1);
    expect(task.transitions[0].phase).toBe("understand");
  });

  test("creates with custom phase", () => {
    const task = createTask({ title: "Quick fix", phase: "implement" });
    expect(task.phase).toBe("implement");
    expect(task.transitions[0].phase).toBe("implement");
  });

  test("creates workstream and updates parent children", () => {
    const parent = createTask({ title: "Epic" });
    const child = createTask({ title: "Workstream", parent: "t1" });
    expect(child.id).toBe("t1-1");
    expect(child.parent).toBe("t1");

    const reloaded = loadTask("t1")!;
    expect(reloaded.children).toContain("t1-1");
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
});

describe("listTasks", () => {
  test("returns empty array when no state dir", () => {
    expect(listTasks()).toEqual([]);
  });

  test("returns all tasks", () => {
    createTask({ title: "A" });
    createTask({ title: "B" });
    const tasks = listTasks();
    expect(tasks).toHaveLength(2);
  });

  test("excludes pipeline files", () => {
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
  test("updates existing task on disk", () => {
    const task = createTask({ title: "Original" });
    task.title = "Updated";
    saveTask(task);
    const loaded = loadTask("t1")!;
    expect(loaded.title).toBe("Updated");
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

  test("persists to disk", () => {
    createTask({ title: "Test" });
    transitionTask("t1", "design");
    const loaded = loadTask("t1")!;
    expect(loaded.phase).toBe("design");
  });

  test("throws for nonexistent task", () => {
    expect(() => transitionTask("t99", "design")).toThrow("not found");
  });

  test("throws for epic", () => {
    createTask({ title: "Epic" });
    createTask({ title: "Child", parent: "t1" });
    expect(() => transitionTask("t1", "design")).toThrow("epic");
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
    createTask({ title: "Epic" });
    createTask({ title: "WS1", parent: "t1", phase: "implement" });
    createTask({ title: "WS2", parent: "t1", phase: "verify" });
    expect(deriveEpicPhase("t1")).toBe("implement");
  });

  test("returns done when all children done", () => {
    createTask({ title: "Epic" });
    const c1 = createTask({ title: "WS1", parent: "t1", phase: "implement" });
    const c2 = createTask({ title: "WS2", parent: "t1", phase: "implement" });
    transitionTask("t1-1", "done", { force: true });
    transitionTask("t1-2", "done", { force: true });
    expect(deriveEpicPhase("t1")).toBe("done");
  });

  test("returns cancelled when all children cancelled", () => {
    createTask({ title: "Epic" });
    createTask({ title: "WS1", parent: "t1" });
    createTask({ title: "WS2", parent: "t1" });
    transitionTask("t1-1", "cancelled");
    transitionTask("t1-2", "cancelled");
    expect(deriveEpicPhase("t1")).toBe("cancelled");
  });

  test("returns done when mix of done and cancelled", () => {
    createTask({ title: "Epic" });
    createTask({ title: "WS1", parent: "t1", phase: "implement" });
    createTask({ title: "WS2", parent: "t1" });
    transitionTask("t1-1", "done", { force: true });
    transitionTask("t1-2", "cancelled");
    expect(deriveEpicPhase("t1")).toBe("done");
  });

  test("ignores terminal children when non-terminal exist", () => {
    createTask({ title: "Epic" });
    createTask({ title: "WS1", parent: "t1", phase: "implement" });
    createTask({ title: "WS2", parent: "t1" });
    transitionTask("t1-1", "done", { force: true });
    // t1-2 is still in understand
    expect(deriveEpicPhase("t1")).toBe("understand");
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
    ensureSetup();
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
