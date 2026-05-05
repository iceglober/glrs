// pilot-build-circuit.test.ts — unit tests for the circuit breakers.
//
// Uses in-memory SQLite. Tests are deterministic via injected timestamps.

import { describe, test, expect } from "bun:test";
import { openStateDb } from "../src/pilot/state/db.js";
import { createRun } from "../src/pilot/state/runs.js";
import { upsertFromPlan } from "../src/pilot/state/tasks.js";
import { readEventsDecoded } from "../src/pilot/state/events.js";
import { CircuitBreaker, computeSignature } from "../src/pilot/build/circuit.js";
import type { Plan } from "../src/pilot/plan/schema.js";

// --- Helpers ----------------------------------------------------------------

function makeDb(): { db: ReturnType<typeof openStateDb>["db"]; runId: string } {
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

function makeBreaker(
  db: ReturnType<typeof openStateDb>["db"],
  runId: string,
  config?: ConstructorParameters<typeof CircuitBreaker>[0]["config"],
  startedAtMs = 1000,
): CircuitBreaker {
  return new CircuitBreaker({
    db,
    runId,
    taskId: "T1",
    config,
    startedAtMs,
  });
}

function makeCheckInput(overrides: {
  command?: string;
  exitCode?: number;
  output?: string;
  attemptCostUsd?: number;
  nowMs?: number;
} = {}) {
  return {
    command: overrides.command ?? "bun test",
    exitCode: overrides.exitCode ?? 1,
    output: overrides.output ?? "test failed",
    attemptCostUsd: overrides.attemptCostUsd,
    nowMs: overrides.nowMs,
  };
}

// --- Cost circuit breaker ---------------------------------------------------

describe("CircuitBreaker — cost", () => {
  test("trips on cumulative cost exceeding max_total_cost_usd", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { maxTotalCostUsd: 5.0 });

    // First attempt: $3 — under limit.
    const r1 = breaker.check(makeCheckInput({ attemptCostUsd: 3.0 }));
    expect(r1.tripped).toBe(false);

    // Second attempt: $3 more = $6 total — over limit.
    const r2 = breaker.check(makeCheckInput({ attemptCostUsd: 3.0 }));
    expect(r2.tripped).toBe(true);
    if (!r2.tripped) return;
    expect(r2.breaker).toBe("cost");
    expect(r2.threshold).toBe(5.0);
    expect(r2.actual).toBe(6.0);
  });

  test("does not trip when cost is exactly at the limit", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { maxTotalCostUsd: 5.0 });

    const r = breaker.check(makeCheckInput({ attemptCostUsd: 5.0 }));
    expect(r.tripped).toBe(false);
  });

  test("emits task.circuit.tripped event on cost trip", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { maxTotalCostUsd: 2.0 });

    breaker.check(makeCheckInput({ attemptCostUsd: 3.0 }));

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const tripEvent = events.find((e) => e.kind === "task.circuit.tripped");
    expect(tripEvent).toBeDefined();
    const payload = tripEvent!.payload as Record<string, unknown>;
    expect(payload.breaker).toBe("cost");
  });
});

// --- Wall-time circuit breaker ----------------------------------------------

describe("CircuitBreaker — wall-time", () => {
  test("trips on wall-time exceeding max_run_wall_ms", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { maxRunWallMs: 60_000 }, 0);

    // Check at 30s — under limit.
    const r1 = breaker.check(makeCheckInput({ nowMs: 30_000 }));
    expect(r1.tripped).toBe(false);

    // Check at 90s — over limit.
    const r2 = breaker.check(makeCheckInput({ nowMs: 90_000 }));
    expect(r2.tripped).toBe(true);
    if (!r2.tripped) return;
    expect(r2.breaker).toBe("wall-time");
    expect(r2.threshold).toBe(60_000);
    expect(r2.actual).toBe(90_000);
  });

  test("does not trip when wall-time is exactly at the limit", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { maxRunWallMs: 60_000 }, 0);

    const r = breaker.check(makeCheckInput({ nowMs: 60_000 }));
    expect(r.tripped).toBe(false);
  });

  test("emits task.circuit.tripped event on wall-time trip", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { maxRunWallMs: 1_000 }, 0);

    breaker.check(makeCheckInput({ nowMs: 2_000 }));

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const tripEvent = events.find((e) => e.kind === "task.circuit.tripped");
    expect(tripEvent).toBeDefined();
    const payload = tripEvent!.payload as Record<string, unknown>;
    expect(payload.breaker).toBe("wall-time");
  });
});

// --- Signature recurrence circuit breaker -----------------------------------

describe("CircuitBreaker — signature recurrence", () => {
  test("trips on signature recurrence (3 identical failures)", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { signatureRecurrenceLimit: 3 });

    const input = makeCheckInput({ output: "expect(a).toBe(b) — Expected: 1, Received: 0" });

    const r1 = breaker.check(input);
    expect(r1.tripped).toBe(false);

    const r2 = breaker.check(input);
    expect(r2.tripped).toBe(false);

    const r3 = breaker.check(input);
    expect(r3.tripped).toBe(true);
    if (!r3.tripped) return;
    expect(r3.breaker).toBe("signature-recurrence");
    expect(r3.threshold).toBe(3);
    expect(r3.actual).toBe(3);
  });

  test("does not trip on different failure signatures", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { signatureRecurrenceLimit: 3 });

    breaker.check(makeCheckInput({ output: "error A" }));
    breaker.check(makeCheckInput({ output: "error B" }));
    const r3 = breaker.check(makeCheckInput({ output: "error C" }));
    expect(r3.tripped).toBe(false);
  });

  test("emits task.circuit.tripped event on signature trip", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, { signatureRecurrenceLimit: 2 });

    const input = makeCheckInput({ output: "same error every time" });
    breaker.check(input);
    breaker.check(input);

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const tripEvent = events.find((e) => e.kind === "task.circuit.tripped");
    expect(tripEvent).toBeDefined();
    const payload = tripEvent!.payload as Record<string, unknown>;
    expect(payload.breaker).toBe("signature-recurrence");
  });
});

// --- No trip when thresholds not reached ------------------------------------

describe("CircuitBreaker — does not trip when thresholds not reached", () => {
  test("does not trip when thresholds not reached", () => {
    const { db, runId } = makeDb();
    const breaker = makeBreaker(db, runId, {
      maxTotalCostUsd: 100,
      maxRunWallMs: 3_600_000,
      signatureRecurrenceLimit: 5,
    }, 0);

    for (let i = 0; i < 4; i++) {
      const r = breaker.check(makeCheckInput({
        attemptCostUsd: 1.0,
        nowMs: (i + 1) * 10_000,
        output: "same error",
      }));
      expect(r.tripped).toBe(false);
    }
  });

  test("no events emitted when no breaker trips", () => {
    const { db, runId } = makeDb();
    const now = Date.now();
    const breaker = makeBreaker(db, runId, {
      maxTotalCostUsd: 100,
      maxRunWallMs: 3_600_000,
    }, now);

    breaker.check(makeCheckInput({ attemptCostUsd: 1.0, nowMs: now + 1000 }));

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    expect(events.filter((e) => e.kind === "task.circuit.tripped")).toHaveLength(0);
  });
});

// --- Signature hashing ------------------------------------------------------

describe("computeSignature", () => {
  test("same inputs produce same signature", () => {
    const s1 = computeSignature("bun test", 1, "error output");
    const s2 = computeSignature("bun test", 1, "error output");
    expect(s1).toBe(s2);
  });

  test("different commands produce different signatures", () => {
    const s1 = computeSignature("bun test", 1, "error");
    const s2 = computeSignature("bun run typecheck", 1, "error");
    expect(s1).not.toBe(s2);
  });

  test("different exit codes produce different signatures", () => {
    const s1 = computeSignature("bun test", 1, "error");
    const s2 = computeSignature("bun test", 2, "error");
    expect(s1).not.toBe(s2);
  });

  test("strips ANSI codes before hashing", () => {
    const s1 = computeSignature("bun test", 1, "\x1b[31merror\x1b[0m");
    const s2 = computeSignature("bun test", 1, "error");
    expect(s1).toBe(s2);
  });

  test("strips timestamps before hashing (same error, different timestamps)", () => {
    const s1 = computeSignature("bun test", 1, "2024-01-15T14:30:25Z error: test failed");
    const s2 = computeSignature("bun test", 1, "2024-06-20T09:15:00Z error: test failed");
    expect(s1).toBe(s2);
  });
});
