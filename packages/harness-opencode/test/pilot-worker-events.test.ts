// pilot-worker-events.test.ts — locks the two new payload-field additions
// introduced in the legibility/diagnostics upgrade:
//
//   task.verify.failed  → gains `of: maxAttempts`
//   task.blocked        → gains `failedDep: <upstream-task-id>`
//
// These tests exercise the worker end-to-end (same harness as
// pilot-worker.test.ts) and assert the new fields are present in the
// emitted events. The CLI streaming-logger tests inject synthetic events
// and therefore cannot catch a regression where the worker stops emitting
// these fields — this file is the contract lock.

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { openStateDb } from "../src/pilot/state/db.js";
import { createRun } from "../src/pilot/state/runs.js";
import { upsertFromPlan } from "../src/pilot/state/tasks.js";
import { readEventsDecoded } from "../src/pilot/state/events.js";
import { makeScheduler } from "../src/pilot/scheduler/ready-set.js";
import { WorktreePool } from "../src/pilot/worktree/pool.js";
import { gitIsAvailable } from "../src/pilot/worktree/git.js";
import { runWorker } from "../src/pilot/worker/worker.js";
import type { Plan, PlanTask } from "../src/pilot/plan/schema.js";
import type { EventHandler } from "../src/pilot/opencode/events.js";

// ---------------------------------------------------------------------------
// Fixtures (mirrors pilot-worker.test.ts)
// ---------------------------------------------------------------------------

let GIT_OK = false;
beforeAll(async () => {
  GIT_OK = await gitIsAvailable();
});

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-worker-events-test-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-b", "main", "--quiet", dir], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "T"]);
  execFileSync("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
}
function gitCommitFile(repo: string, name: string, content: string, msg: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), content);
  execFileSync("git", ["-C", repo, "add", name]);
  execFileSync("git", ["-C", repo, "commit", "-m", msg, "--quiet"]);
}

function makePlan(specs: Array<{
  id: string;
  touches?: string[];
  verify?: string[];
  depends_on?: string[];
}>): Plan {
  const tasks: PlanTask[] = specs.map((s) => ({
    id: s.id,
    title: `task ${s.id}`,
    prompt: `do ${s.id}`,
    touches: s.touches ?? [],
    verify: s.verify ?? [],
    depends_on: s.depends_on ?? [],
  }));
  return {
    name: "worker events test plan",
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

function makeMockBus() {
  const handlers: Array<{ sessionID: string; handler: EventHandler }> = [];

  const bus = {
    on: (sessionID: string, handler: EventHandler) => {
      const sub = { sessionID, handler };
      handlers.push(sub);
      return () => {
        const i = handlers.indexOf(sub);
        if (i !== -1) handlers.splice(i, 1);
      };
    },
    waitForIdle: async (sessionID: string, opts: { stallMs?: number; abortSignal?: AbortSignal } = {}) => {
      return new Promise<{ kind: string; [k: string]: unknown }>((resolve) => {
        const queue = idleQueue.get(sessionID) ?? [];
        const next = queue.shift();
        if (next) {
          queueMicrotask(() => resolve(next));
        } else {
          const t = setTimeout(() => {
            resolve({ kind: "stall", stallMs: opts.stallMs ?? 1 });
          }, 50);
          if (opts.abortSignal) {
            opts.abortSignal.addEventListener("abort", () => {
              clearTimeout(t);
              resolve({ kind: "abort", reason: opts.abortSignal!.reason });
            }, { once: true });
          }
        }
      });
    },
    close: async () => {},
    getStreamError: () => null,
  };

  const idleQueue = new Map<string, Array<{ kind: string; [k: string]: unknown }>>();
  const pushIdleResult = (sessionID: string, result: { kind: string; [k: string]: unknown }) => {
    const q = idleQueue.get(sessionID) ?? [];
    q.push(result);
    idleQueue.set(sessionID, q);
  };

  return { bus, pushIdleResult };
}

function makeMockClient(opts: {
  sessionId?: string;
  promptAsyncImpl?: (args: unknown) => void | Promise<void>;
} = {}) {
  const sessionId = opts.sessionId ?? "ses_test_1";
  const client = {
    session: {
      create: async () => ({ data: { id: sessionId } }),
      promptAsync: async (args: unknown) => {
        if (opts.promptAsyncImpl) await opts.promptAsyncImpl(args);
        return { data: undefined };
      },
      abort: async () => ({ data: true }),
      get: async () => ({ data: { id: sessionId, cost: 0 } }),
      messages: async () => ({ data: [] }),
    },
  };
  return { client };
}

// ---------------------------------------------------------------------------
// a6: verify.failed payload includes of=maxAttempts
// ---------------------------------------------------------------------------

describe("verify.failed payload includes of=maxAttempts", () => {
  test("task.verify.failed event carries of field equal to maxAttempts", async () => {
    if (!GIT_OK) return;
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    gitInit(repo);
    gitCommitFile(repo, "src/a.ts", "x", "init");

    const wtPath = path.join(tmp, "wt", "00");
    const plan = makePlan([
      { id: "T1", touches: ["src/**"], verify: ["false"] }, // always fails
    ]);
    const opened = openStateDb(":memory:");
    try {
      const runId = createRun(opened.db, { plan, planPath: "/p", slug: "s" });
      upsertFromPlan(opened.db, runId, plan);
      const { bus, pushIdleResult } = makeMockBus();
      const { client } = makeMockClient();
      // maxAttempts=2 → queue 2 idles
      pushIdleResult("ses_test_1", { kind: "idle" });
      pushIdleResult("ses_test_1", { kind: "idle" });

      await runWorker({
        db: opened.db,
        runId,
        plan,
        scheduler: makeScheduler({ db: opened.db, runId, plan }),
        pool: new WorktreePool({
          repoPath: repo,
          worktreeDir: async () => wtPath,
        }),
        client: client as never,
        bus: bus as never,
        branchPrefix: "pilot/x",
        base: "main",
        maxAttempts: 2,
        stallMs: 5_000,
      });

      const events = readEventsDecoded(opened.db, { runId, taskId: "T1" });
      const verifyFailedEvents = events.filter((e) => e.kind === "task.verify.failed");

      // Both attempts should have emitted task.verify.failed with of=2.
      expect(verifyFailedEvents.length).toBe(2);
      for (const ev of verifyFailedEvents) {
        const p = ev.payload as { attempt?: number; of?: number };
        expect(p.of).toBe(2);
      }
      // First attempt has attempt=1, second has attempt=2.
      const attempts = verifyFailedEvents.map((e) => (e.payload as { attempt?: number }).attempt);
      expect(attempts).toContain(1);
      expect(attempts).toContain(2);
    } finally {
      opened.close();
    }
  });
});

// ---------------------------------------------------------------------------
// a6: task.blocked payload includes failedDep id
// ---------------------------------------------------------------------------

describe("task.blocked payload includes failedDep id", () => {
  test("task.blocked event carries failedDep equal to the failed upstream task id", async () => {
    if (!GIT_OK) return;
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    gitInit(repo);
    gitCommitFile(repo, "src/a.ts", "x", "init");

    const wtPath = path.join(tmp, "wt", "00");
    const plan = makePlan([
      { id: "T1", touches: ["src/**"], verify: ["false"] }, // always fails
      { id: "T2", touches: ["src/**"], verify: ["true"], depends_on: ["T1"] },
    ]);
    const opened = openStateDb(":memory:");
    try {
      const runId = createRun(opened.db, { plan, planPath: "/p", slug: "s" });
      upsertFromPlan(opened.db, runId, plan);
      const { bus, pushIdleResult } = makeMockBus();
      const { client } = makeMockClient();
      // T1 runs maxAttempts=1 → 1 idle
      pushIdleResult("ses_test_1", { kind: "idle" });

      await runWorker({
        db: opened.db,
        runId,
        plan,
        scheduler: makeScheduler({ db: opened.db, runId, plan }),
        pool: new WorktreePool({
          repoPath: repo,
          worktreeDir: async () => wtPath,
        }),
        client: client as never,
        bus: bus as never,
        branchPrefix: "pilot/x",
        base: "main",
        maxAttempts: 1,
        stallMs: 5_000,
      });

      const events = readEventsDecoded(opened.db, { runId });
      const blockedEvents = events.filter((e) => e.kind === "task.blocked");

      // T2 should be blocked with failedDep="T1".
      expect(blockedEvents.length).toBeGreaterThanOrEqual(1);
      const t2Blocked = blockedEvents.find((e) => e.task_id === "T2");
      expect(t2Blocked).toBeDefined();
      const p = t2Blocked!.payload as { failedDep?: string };
      expect(p.failedDep).toBe("T1");
    } finally {
      opened.close();
    }
  });
});
