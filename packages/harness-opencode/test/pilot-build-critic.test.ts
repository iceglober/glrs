// pilot-build-critic.test.ts — unit tests for the Haiku-based critic.
//
// All tests use in-memory SQLite and mock LLM responses — no real API calls.

import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { openStateDb } from "../src/pilot/state/db.js";
import { createRun } from "../src/pilot/state/runs.js";
import { upsertFromPlan } from "../src/pilot/state/tasks.js";
import { readEventsDecoded } from "../src/pilot/state/events.js";
import {
  runCritic,
  type CriticLLMClient,
  type CriticReport,
  type RunCriticOptions,
} from "../src/pilot/build/critic.js";
import type { ClassifyInput } from "../src/pilot/build/classify.js";
import type { Plan } from "../src/pilot/plan/schema.js";

// --- Helpers ----------------------------------------------------------------

function makeDb(): { db: Database; runId: string } {
  const opened = openStateDb(":memory:");
  const db = opened.db;
  const plan: Plan = {
    name: "test plan",
    defaults: {
      model: "anthropic/claude-sonnet-4-6",
      agent: "pilot-builder",
      max_turns: 50,
      max_cost_usd: 5,
      verify_after_each: [],
    },
    milestones: [],
    tasks: [
      {
        id: "T1",
        title: "test task",
        prompt: "do the thing",
        touches: ["src/**"],
        tolerate: [],
        verify: [],
        depends_on: [],
      },
    ],
  };
  const runId = createRun(db, { plan, planPath: "/tmp/pilot.yaml", slug: "test" });
  upsertFromPlan(db, runId, plan);
  return { db, runId };
}

function makeFailure(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    command: overrides.command ?? "bun test",
    exitCode: overrides.exitCode ?? 1,
    output: overrides.output ?? "expect(received).toBe(expected)\n  Expected: 42\n  Received: 0",
  };
}

function makeReport(overrides: Partial<CriticReport> = {}): CriticReport {
  return {
    smallestFix: overrides.smallestFix ?? "Change the return value in src/foo.ts line 12 from 0 to 42.",
    narrowScope: overrides.narrowScope ?? "src/foo.ts:12 — the `compute()` function",
    riskFlags: overrides.riskFlags ?? [],
  };
}

function makeOpts(
  db: Database,
  runId: string,
  overrides: Partial<RunCriticOptions> = {},
): RunCriticOptions {
  const report = makeReport();
  const mockLLM: CriticLLMClient = {
    critique: async () => report,
  };
  return {
    db,
    runId,
    taskId: overrides.taskId ?? "T1",
    failure: overrides.failure ?? makeFailure(),
    failureClass: overrides.failureClass ?? "logical",
    taskPrompt: overrides.taskPrompt ?? "Add a compute function that returns 42.",
    touches: overrides.touches ?? ["src/foo.ts"],
    reflexion: overrides.reflexion ?? true,
    llm: overrides.llm ?? mockLLM,
  };
}

// --- Happy path -------------------------------------------------------------

describe("runCritic — happy path", () => {
  test("returns structured CriticReport from mock LLM", async () => {
    const { db, runId } = makeDb();
    const expectedReport = makeReport({
      smallestFix: "Fix the off-by-one error in line 42.",
      narrowScope: "src/counter.ts:42",
      riskFlags: ["may affect downstream callers"],
    });
    const opts = makeOpts(db, runId, {
      llm: { critique: async () => expectedReport },
    });

    const result = await runCritic(opts);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.smallestFix).toBe("Fix the off-by-one error in line 42.");
    expect(result.report.narrowScope).toBe("src/counter.ts:42");
    expect(result.report.riskFlags).toEqual(["may affect downstream callers"]);
  });

  test("emits task.critic.report event", async () => {
    const { db, runId } = makeDb();
    const opts = makeOpts(db, runId);

    await runCritic(opts);

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const criticEvent = events.find((e) => e.kind === "task.critic.report");
    expect(criticEvent).toBeDefined();
    expect(criticEvent!.payload).toMatchObject({
      failureClass: "logical",
    });
    const payload = criticEvent!.payload as Record<string, unknown>;
    expect(typeof payload.smallestFix).toBe("string");
    expect(typeof payload.narrowScope).toBe("string");
    expect(Array.isArray(payload.riskFlags)).toBe(true);
  });
});

// --- Disabled path ----------------------------------------------------------

describe("runCritic — disabled", () => {
  test("skipped when reflexion is disabled", async () => {
    const { db, runId } = makeDb();
    let called = false;
    const opts = makeOpts(db, runId, {
      reflexion: false,
      llm: {
        critique: async () => {
          called = true;
          return makeReport();
        },
      },
    });

    const result = await runCritic(opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("disabled");
    expect(called).toBe(false);

    // No events emitted when disabled.
    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    expect(events.filter((e) => e.kind === "task.critic.report")).toHaveLength(0);
  });
});

// --- Error handling ---------------------------------------------------------

describe("runCritic — error handling", () => {
  test("handles LLM timeout gracefully", async () => {
    const { db, runId } = makeDb();
    const opts = makeOpts(db, runId, {
      llm: {
        critique: async () => {
          const err = new Error("Request timed out");
          err.name = "TimeoutError";
          throw err;
        },
      },
    });

    const result = await runCritic(opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("llm-timeout");

    // Emits a failure event.
    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const failEvent = events.find((e) => e.kind === "task.critic.failed");
    expect(failEvent).toBeDefined();
  });

  test("handles LLM generic error gracefully", async () => {
    const { db, runId } = makeDb();
    const opts = makeOpts(db, runId, {
      llm: {
        critique: async () => {
          throw new Error("LLM unavailable");
        },
      },
    });

    const result = await runCritic(opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("llm-failed");
  });

  test("handles LLM returning null gracefully", async () => {
    const { db, runId } = makeDb();
    const opts = makeOpts(db, runId, {
      llm: { critique: async () => null },
    });

    const result = await runCritic(opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("llm-failed");
  });
});
