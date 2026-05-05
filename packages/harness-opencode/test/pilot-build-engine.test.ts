// pilot-build-engine.test.ts — integration tests for the retry engine.
//
// Tests mock sub-modules (classify, critic, diversify, circuit, retry-strategy)
// and validate the full pipeline routing.
//
// Uses a real tmp git repo for retry-strategy (which runs git commands).

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { openStateDb } from "../src/pilot/state/db.js";
import { createRun } from "../src/pilot/state/runs.js";
import { upsertFromPlan } from "../src/pilot/state/tasks.js";
import { readEventsDecoded } from "../src/pilot/state/events.js";
import {
  processAttempt,
  createCircuitBreaker,
  type EngineAttemptInput,
  type EngineConfig,
} from "../src/pilot/build/engine.js";
import type { LastFailure } from "../src/pilot/opencode/prompts.js";
import type { Plan } from "../src/pilot/plan/schema.js";
import type { CriticLLMClient, CriticReport } from "../src/pilot/build/critic.js";

// --- Fixtures ---------------------------------------------------------------

let tmp: string;
let db: ReturnType<typeof openStateDb>["db"];
let runId: string;

beforeEach(() => {
  // Set up tmp git repo.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-engine-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, "README.md"), "initial\n");
  execFileSync("git", ["add", "."], { cwd: tmp });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: tmp });

  // Set up in-memory DB.
  const opened = openStateDb(":memory:");
  db = opened.db;
  const plan: Plan = {
    name: "test plan",
    defaults: {
      model: "anthropic/claude-sonnet-4-6",
      agent: "pilot-builder",
      max_turns: 50,
      max_cost_usd: 5,
      verify_after_each: [],
      critic_model: "anthropic/claude-haiku-4-5",
      reflexion: false,
      diversify: "none",
      retry_strategy: "reset",
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
  runId = createRun(db, { plan, planPath: "/tmp/pilot.yaml", slug: "test" });
  upsertFromPlan(db, runId, plan);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- Helpers ----------------------------------------------------------------

function makeFailure(overrides: Partial<LastFailure> = {}): LastFailure {
  return {
    command: overrides.command ?? "bun test",
    exitCode: overrides.exitCode ?? 1,
    output: overrides.output ?? "expect(a).toBe(b) — Expected: 1, Received: 0",
    touchesViolators: overrides.touchesViolators,
    criticReport: overrides.criticReport,
  };
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    reflexion: overrides.reflexion ?? false,
    diversify: overrides.diversify ?? "none",
    retryStrategy: overrides.retryStrategy ?? "reset",
    circuitBreaker: overrides.circuitBreaker,
    classifyLLM: overrides.classifyLLM,
    criticLLM: overrides.criticLLM,
  };
}

function makeInput(overrides: Partial<EngineAttemptInput> = {}): EngineAttemptInput {
  const config = overrides.config ?? makeConfig();
  const breaker = overrides.circuitBreaker ?? createCircuitBreaker({
    db,
    runId,
    taskId: "T1",
    config: config.circuitBreaker,
    startedAtMs: Date.now(),
  });
  return {
    db,
    runId,
    taskId: "T1",
    cwd: tmp,
    failure: overrides.failure ?? makeFailure(),
    attempt: overrides.attempt ?? 1,
    maxAttempts: overrides.maxAttempts ?? 5,
    taskPrompt: overrides.taskPrompt ?? "Add a compute function.",
    touches: overrides.touches ?? ["src/**"],
    config,
    circuitBreaker: breaker,
  };
}

// --- Routing tests ----------------------------------------------------------

describe("processAttempt — routing", () => {
  test("routes transient failure to immediate retry without critic", async () => {
    const input = makeInput({
      failure: makeFailure({ output: "Error: read ECONNRESET" }),
      config: makeConfig({ diversify: "standard", reflexion: true }),
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    // No critic report — transient failures skip critic.
    expect(result.enrichedFailure.criticReport).toBeUndefined();
    expect(result.useAltModel).toBe(false);
    expect(result.freshSubagent).toBe(false);
  });

  test("routes logical failure through full pipeline", async () => {
    const criticReport: CriticReport = {
      smallestFix: "Fix the assertion in src/foo.ts:42",
      narrowScope: "src/foo.ts:42",
      riskFlags: [],
    };
    const mockCriticLLM: CriticLLMClient = {
      critique: async () => criticReport,
    };

    const input = makeInput({
      failure: makeFailure({
        output: "expect(received).toBe(expected)\n  Expected: 42\n  Received: 0",
      }),
      attempt: 2, // attempt 2 triggers run-critic in standard mode
      config: makeConfig({
        diversify: "standard",
        reflexion: true,
        criticLLM: mockCriticLLM,
      }),
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    // Critic report should be present.
    expect(result.enrichedFailure.criticReport).toBeDefined();
    expect(result.enrichedFailure.criticReport?.smallestFix).toBe(
      "Fix the assertion in src/foo.ts:42",
    );
  });

  test("respects circuit breaker and halts", async () => {
    const breaker = createCircuitBreaker({
      db,
      runId,
      taskId: "T1",
      config: { signatureRecurrenceLimit: 1 }, // trip on first recurrence
      startedAtMs: Date.now(),
    });

    const input = makeInput({
      failure: makeFailure({ output: "same error every time" }),
      circuitBreaker: breaker,
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("halt");
    if (result.action !== "halt") return;
    expect(result.reason).toMatch(/circuit breaker/i);
  });

  test("defaults produce identical behavior to current worker", async () => {
    // With all defaults (none diversify, no reflexion, reset strategy),
    // the engine should return retry with the original failure unchanged.
    const originalFailure = makeFailure();
    const input = makeInput({
      failure: originalFailure,
      config: makeConfig(), // all defaults
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    // No critic report — reflexion is disabled.
    expect(result.enrichedFailure.criticReport).toBeUndefined();
    // Original failure fields preserved.
    expect(result.enrichedFailure.command).toBe(originalFailure.command);
    expect(result.enrichedFailure.exitCode).toBe(originalFailure.exitCode);
    expect(result.enrichedFailure.output).toBe(originalFailure.output);
    expect(result.useAltModel).toBe(false);
    expect(result.freshSubagent).toBe(false);
  });
});

// --- Event emission ---------------------------------------------------------

describe("processAttempt — event emission", () => {
  test("emits task.classify.result event", async () => {
    const input = makeInput();

    await processAttempt(input);

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const classifyEvent = events.find((e) => e.kind === "task.classify.result");
    expect(classifyEvent).toBeDefined();
    const payload = classifyEvent!.payload as Record<string, unknown>;
    expect(typeof payload.failureClass).toBe("string");
    expect(typeof payload.method).toBe("string");
  });

  test("emits task.diversify.applied event", async () => {
    const input = makeInput();

    await processAttempt(input);

    const events = readEventsDecoded(db, { runId, taskId: "T1" });
    const diversifyEvent = events.find((e) => e.kind === "task.diversify.applied");
    expect(diversifyEvent).toBeDefined();
    const payload = diversifyEvent!.payload as Record<string, unknown>;
    expect(payload.action).toBe("same-strategy");
  });
});

// --- Enriched fixPrompt -----------------------------------------------------

describe("processAttempt — enriched fixPrompt", () => {
  test("enriched fixPrompt includes critic smallestFix", async () => {
    const criticReport: CriticReport = {
      smallestFix: "Change line 42 from `return 0` to `return 42`.",
      narrowScope: "src/compute.ts:42",
      riskFlags: ["may break other callers"],
    };
    const mockCriticLLM: CriticLLMClient = {
      critique: async () => criticReport,
    };

    const input = makeInput({
      failure: makeFailure({
        output: "expect(received).toBe(expected)\n  Expected: 42\n  Received: 0",
      }),
      attempt: 2, // triggers run-critic in standard mode
      config: makeConfig({
        diversify: "standard",
        reflexion: true,
        criticLLM: mockCriticLLM,
      }),
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    expect(result.enrichedFailure.criticReport?.smallestFix).toBe(
      "Change line 42 from `return 0` to `return 42`.",
    );
    expect(result.enrichedFailure.criticReport?.narrowScope).toBe("src/compute.ts:42");
    expect(result.enrichedFailure.criticReport?.riskFlags).toEqual(["may break other callers"]);
  });

  test("fixPrompt without critic matches current format", async () => {
    const originalFailure = makeFailure({
      command: "bun test",
      exitCode: 1,
      output: "test failed",
    });
    const input = makeInput({
      failure: originalFailure,
      config: makeConfig({ reflexion: false }), // no critic
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    // No critic report when reflexion is disabled.
    expect(result.enrichedFailure.criticReport).toBeUndefined();
    // Original fields preserved.
    expect(result.enrichedFailure.command).toBe("bun test");
    expect(result.enrichedFailure.exitCode).toBe(1);
    expect(result.enrichedFailure.output).toBe("test failed");
  });
});

// --- Graceful degradation ---------------------------------------------------

describe("processAttempt — graceful degradation", () => {
  test("proceeds without critic when criticLLM is not provided", async () => {
    const input = makeInput({
      attempt: 2,
      config: makeConfig({
        diversify: "standard",
        reflexion: true,
        criticLLM: undefined, // no LLM provided
      }),
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    // No critic report — LLM not provided.
    expect(result.enrichedFailure.criticReport).toBeUndefined();
  });

  test("proceeds without critic when critic LLM throws", async () => {
    const mockCriticLLM: CriticLLMClient = {
      critique: async () => {
        throw new Error("LLM unavailable");
      },
    };

    const input = makeInput({
      attempt: 2,
      config: makeConfig({
        diversify: "standard",
        reflexion: true,
        criticLLM: mockCriticLLM,
      }),
    });

    const result = await processAttempt(input);

    expect(result.action).toBe("retry");
    if (result.action !== "retry") return;
    // No critic report — LLM failed, graceful degradation.
    expect(result.enrichedFailure.criticReport).toBeUndefined();
  });
});
