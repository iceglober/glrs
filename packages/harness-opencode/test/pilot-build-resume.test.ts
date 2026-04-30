// pilot-build-resume.test.ts — tests for `pilot build-resume`.
//
// Two surfaces:
//   1. State accessor (resetTasksForResume, markRunResumed) — unit tests
//      against an in-memory state DB.
//   2. CLI entry (runBuildResume) — pre-flight error paths; the full
//      happy path requires opencode server spawning and is covered by
//      the manual e2e checklist (pilot-acceptance).

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runBuildResume } from "../src/pilot/cli/build-resume.js";
import { openStateDb } from "../src/pilot/state/db.js";
import { createRun, markRunRunning, markRunFinished, markRunResumed, getRun } from "../src/pilot/state/runs.js";
import {
  upsertFromPlan,
  markReady,
  markRunning,
  markSucceeded,
  markFailed,
  markBlocked,
  setCostUsd,
  getTask,
  listTasks,
  resetTasksForResume,
} from "../src/pilot/state/tasks.js";
import { getStateDbPath, getRunDir } from "../src/pilot/paths.js";
import type { Plan, PlanTask } from "../src/pilot/plan/schema.js";

// --- Fixtures --------------------------------------------------------------

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-build-resume-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function gitInit(dir: string, branch = "main"): void {
  execFileSync("git", ["init", "-b", branch, "--quiet", dir], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  execFileSync("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(dir, "README.md"), "x");
  execFileSync("git", ["-C", dir, "add", "README.md"]);
  execFileSync("git", ["-C", dir, "commit", "-m", "init", "--quiet"]);
}

function makePlan(ids: string[]): Plan {
  const tasks: PlanTask[] = ids.map((id) => ({
    id,
    title: `task ${id}`,
    prompt: "p",
    touches: [],
    tolerate: [],
    verify: [],
    depends_on: [],
  }));
  return {
    name: "resume test",
    defaults: {
      model: "anthropic/claude-sonnet-4-6",
      agent: "pilot-builder",
      max_turns: 50,
      max_cost_usd: 5,
      verify_after_each: [],
    },
    milestones: [],
    tasks,
  };
}

// --- resetTasksForResume (state accessor) ----------------------------------

describe("resetTasksForResume", () => {
  test("resets non-succeeded tasks to pending with attempts=0, preserves cost", () => {
    const opened = openStateDb(":memory:");
    try {
      const plan = makePlan(["T1", "T2", "T3"]);
      const runId = createRun(opened.db, {
        plan,
        planPath: "/plan.yaml",
        slug: "slug",
      });
      upsertFromPlan(opened.db, runId, plan);

      // T1 → succeeded (should survive the reset).
      markReady(opened.db, runId, "T1");
      markRunning(opened.db, {
        runId,
        taskId: "T1",
        sessionId: "s1",
        branch: "feat/x",
        worktreePath: "/repo",
      });
      setCostUsd(opened.db, runId, "T1", 0.5);
      markSucceeded(opened.db, runId, "T1");

      // T2 → failed.
      markReady(opened.db, runId, "T2");
      markRunning(opened.db, {
        runId,
        taskId: "T2",
        sessionId: "s2",
        branch: "feat/x",
        worktreePath: "/repo",
      });
      setCostUsd(opened.db, runId, "T2", 1.5);
      markFailed(opened.db, runId, "T2", "boom");

      // T3 → blocked (by T2 failure).
      markBlocked(opened.db, runId, "T3", "dependency T2 failed");

      const resetIds = resetTasksForResume(opened.db, runId);
      expect(resetIds.sort()).toEqual(["T2", "T3"]);

      // T1 untouched.
      const t1 = getTask(opened.db, runId, "T1");
      expect(t1?.status).toBe("succeeded");
      expect(t1?.cost_usd).toBe(0.5);
      expect(t1?.session_id).toBe("s1");

      // T2 reset but cost preserved.
      const t2 = getTask(opened.db, runId, "T2");
      expect(t2?.status).toBe("pending");
      expect(t2?.attempts).toBe(0);
      expect(t2?.session_id).toBeNull();
      expect(t2?.last_error).toBeNull();
      expect(t2?.branch).toBeNull();
      expect(t2?.worktree_path).toBeNull();
      expect(t2?.cost_usd).toBe(1.5); // preserved

      // T3 reset.
      const t3 = getTask(opened.db, runId, "T3");
      expect(t3?.status).toBe("pending");
    } finally {
      opened.close();
    }
  });

  test("returns empty array when all tasks are succeeded", () => {
    const opened = openStateDb(":memory:");
    try {
      const plan = makePlan(["T1"]);
      const runId = createRun(opened.db, {
        plan,
        planPath: "/plan.yaml",
        slug: "s",
      });
      upsertFromPlan(opened.db, runId, plan);
      markReady(opened.db, runId, "T1");
      markRunning(opened.db, {
        runId,
        taskId: "T1",
        sessionId: "s1",
        branch: "",
        worktreePath: "/repo",
      });
      markSucceeded(opened.db, runId, "T1");

      const resetIds = resetTasksForResume(opened.db, runId);
      expect(resetIds).toEqual([]);
    } finally {
      opened.close();
    }
  });
});

// --- markRunResumed --------------------------------------------------------

describe("markRunResumed", () => {
  test("moves a failed run back to running, clears finished_at", () => {
    const opened = openStateDb(":memory:");
    try {
      const plan = makePlan(["T1"]);
      const runId = createRun(opened.db, {
        plan,
        planPath: "/plan.yaml",
        slug: "s",
      });
      markRunRunning(opened.db, runId);
      markRunFinished(opened.db, runId, "failed");

      markRunResumed(opened.db, runId);
      const run = getRun(opened.db, runId);
      expect(run?.status).toBe("running");
      expect(run?.finished_at).toBeNull();
    } finally {
      opened.close();
    }
  });

  test("refuses to resume a completed run", () => {
    const opened = openStateDb(":memory:");
    try {
      const plan = makePlan(["T1"]);
      const runId = createRun(opened.db, {
        plan,
        planPath: "/plan.yaml",
        slug: "s",
      });
      markRunRunning(opened.db, runId);
      markRunFinished(opened.db, runId, "completed");

      expect(() => markRunResumed(opened.db, runId)).toThrow(
        /already completed/,
      );
    } finally {
      opened.close();
    }
  });
});

// --- runBuildResume pre-flight ---------------------------------------------

async function captured(
  fn: () => Promise<number>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array): boolean => {
    out.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array): boolean => {
    err.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  let code: number;
  try {
    code = await fn();
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
  return { stdout: out.join(""), stderr: err.join(""), code };
}

describe("runBuildResume — pre-flight error paths", () => {
  test("exit 2 when no resumable runs exist in the repo", async () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    gitInit(repo, "feat/x");
    process.env.GLORIOUS_PILOT_DIR = path.join(tmp, "pilot-base");

    const prevCwd = process.cwd();
    process.chdir(repo);
    try {
      const r = await captured(() => runBuildResume({}));
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/no resumable runs/);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("exit 2 when run is fully succeeded", async () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    gitInit(repo, "feat/x");
    process.env.GLORIOUS_PILOT_DIR = path.join(tmp, "pilot-base");

    const prevCwd = process.cwd();
    process.chdir(repo);
    try {
      // Seed a fully-succeeded run.
      const runId = "01FULL1SUCCESS2EDRUNAABBCC";
      await getRunDir(repo, runId);
      const dbPath = await getStateDbPath(repo, runId);
      const opened = openStateDb(dbPath);
      try {
        const plan = makePlan(["T1"]);
        opened.db.run(
          `INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES (?, ?, ?, ?, ?)`,
          [runId, "/plan.yaml", "slug", Date.now(), "completed"],
        );
        upsertFromPlan(opened.db, runId, plan);
        markReady(opened.db, runId, "T1");
        markRunning(opened.db, {
          runId,
          taskId: "T1",
          sessionId: "s1",
          branch: "feat/x",
          worktreePath: repo,
        });
        markSucceeded(opened.db, runId, "T1");
      } finally {
        opened.close();
      }

      const r = await captured(() => runBuildResume({ run: runId }));
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/no tasks to resume/);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("exit 1 when branch does not match run's recorded branch", async () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    gitInit(repo, "main");
    execFileSync("git", ["-C", repo, "checkout", "-b", "feat/different"]);
    process.env.GLORIOUS_PILOT_DIR = path.join(tmp, "pilot-base");

    const prevCwd = process.cwd();
    process.chdir(repo);
    try {
      // Seed a run whose succeeded task was on a DIFFERENT branch.
      const runId = "01BRANCHMISMATCH234567890A";
      await getRunDir(repo, runId);
      const dbPath = await getStateDbPath(repo, runId);
      const planPath = path.join(tmp, "plan.yaml");
      fs.writeFileSync(
        planPath,
        `name: resume test\ntasks:\n  - id: T1\n    title: x\n    prompt: p\n  - id: T2\n    title: y\n    prompt: p\n`,
      );

      const opened = openStateDb(dbPath);
      try {
        const plan = makePlan(["T1", "T2"]);
        opened.db.run(
          `INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES (?, ?, ?, ?, ?)`,
          [runId, planPath, "slug", Date.now(), "failed"],
        );
        upsertFromPlan(opened.db, runId, plan);
        markReady(opened.db, runId, "T1");
        markRunning(opened.db, {
          runId,
          taskId: "T1",
          sessionId: "s1",
          branch: "feat/original", // DIFFERENT from current branch
          worktreePath: repo,
        });
        markSucceeded(opened.db, runId, "T1");
        markReady(opened.db, runId, "T2");
        markRunning(opened.db, {
          runId,
          taskId: "T2",
          sessionId: "s2",
          branch: "feat/original",
          worktreePath: repo,
        });
        markFailed(opened.db, runId, "T2", "boom");
      } finally {
        opened.close();
      }

      const r = await captured(() => runBuildResume({ run: runId }));
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/branch mismatch/);
      expect(r.stderr).toMatch(/feat\/original/);
      expect(r.stderr).toMatch(/feat\/different/);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("exit 1 when cwd is on main (safety gate)", async () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    gitInit(repo, "main");
    process.env.GLORIOUS_PILOT_DIR = path.join(tmp, "pilot-base");

    const prevCwd = process.cwd();
    process.chdir(repo);
    try {
      const runId = "01MAINBRANCHRESUMETESTAAAA";
      await getRunDir(repo, runId);
      const dbPath = await getStateDbPath(repo, runId);
      const planPath = path.join(tmp, "plan.yaml");
      fs.writeFileSync(
        planPath,
        `name: resume test\ntasks:\n  - id: T1\n    title: x\n    prompt: p\n`,
      );
      const opened = openStateDb(dbPath);
      try {
        const plan = makePlan(["T1"]);
        opened.db.run(
          `INSERT INTO runs (id, plan_path, plan_slug, started_at, status) VALUES (?, ?, ?, ?, ?)`,
          [runId, planPath, "slug", Date.now(), "failed"],
        );
        upsertFromPlan(opened.db, runId, plan);
        markReady(opened.db, runId, "T1");
        markRunning(opened.db, {
          runId,
          taskId: "T1",
          sessionId: "s1",
          branch: "feat/x",
          worktreePath: repo,
        });
        markFailed(opened.db, runId, "T1", "boom");
      } finally {
        opened.close();
      }

      const r = await captured(() => runBuildResume({ run: runId }));
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/refuse to run on protected branch.*main/);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
