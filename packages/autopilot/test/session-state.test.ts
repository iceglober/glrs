/**
 * Tests for deriveState — pure event-replay state derivation.
 */

import { describe, it, expect } from "bun:test";
import { deriveState } from "../src/session-state.js";
import type { SessionEvent } from "../src/session-events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ts = (offset = 0) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();

function sessionStart(overrides: Partial<{
  planPath: string;
  cwd: string;
  fast: boolean;
  resume: boolean;
}> = {}): SessionEvent {
  return {
    type: "session:start",
    timestamp: ts(0),
    planPath: "/plans/main.md",
    cwd: "/repo",
    fast: false,
    resume: false,
    ...overrides,
  };
}

function sessionDone(overrides: Partial<{
  exitReason: string;
  iterations: number;
  cumulativeCostUsd: number;
}> = {}): SessionEvent {
  return {
    type: "session:done",
    timestamp: ts(60),
    exitReason: "sentinel",
    iterations: 3,
    message: "Done",
    ...overrides,
  };
}

function iterationStart(iteration: number, max = 10): SessionEvent {
  return {
    type: "iteration:start",
    timestamp: ts(iteration),
    iteration,
    maxIterations: max,
  };
}

function iterationDone(iteration: number, costUsd = 0.01): SessionEvent {
  return {
    type: "iteration:done",
    timestamp: ts(iteration + 1),
    iteration,
    durationMs: 1000,
    madeProgress: true,
    costUsd,
  };
}

function phaseStart(phase: string, current: number, total: number): SessionEvent {
  return {
    type: "phase:start",
    timestamp: ts(current),
    phase,
    laneId: "main",
    current,
    total,
  };
}

function phaseDone(phase: string): SessionEvent {
  return {
    type: "phase:done",
    timestamp: ts(99),
    phase,
    laneId: "main",
    completed: true,
    iterations: 2,
    costUsd: 0.05,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveState", () => {
  it("returns null for empty event stream", () => {
    expect(deriveState([])).toBeNull();
  });

  it("returns null when no session:start event", () => {
    const events: SessionEvent[] = [iterationDone(1)];
    expect(deriveState(events)).toBeNull();
  });

  it("derives basic fields from session:start", () => {
    const handle = deriveState([sessionStart({ planPath: "/plans/foo.md", cwd: "/myrepo" })]);
    expect(handle).not.toBeNull();
    expect(handle!.planPath).toBe("/plans/foo.md");
    expect(handle!.cwd).toBe("/myrepo");
    expect(handle!.fast).toBe(false);
    expect(handle!.resume).toBe(false);
    expect(handle!.status).toBe("running");
    expect(handle!.startedAt).toBe(ts(0));
  });

  it("generates a stable id from planPath + timestamp", () => {
    const h1 = deriveState([sessionStart({ planPath: "/plans/a.md" })]);
    const h2 = deriveState([sessionStart({ planPath: "/plans/a.md" })]);
    const h3 = deriveState([sessionStart({ planPath: "/plans/b.md" })]);
    expect(h1!.id).toBe(h2!.id);
    expect(h1!.id).not.toBe(h3!.id);
  });

  it("fast and resume flags are preserved", () => {
    const handle = deriveState([sessionStart({ fast: true, resume: true })]);
    expect(handle!.fast).toBe(true);
    expect(handle!.resume).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Happy path: complete session
  // ---------------------------------------------------------------------------

  it("happy path: complete session with iterations", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      phaseStart("Phase 1", 1, 2),
      iterationStart(1),
      iterationDone(1, 0.02),
      iterationStart(2),
      iterationDone(2, 0.04),
      phaseDone("Phase 1"),
      phaseStart("Phase 2", 2, 2),
      iterationStart(3),
      iterationDone(3, 0.06),
      phaseDone("Phase 2"),
      sessionDone({ exitReason: "sentinel", iterations: 3, cumulativeCostUsd: 0.12 }),
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("complete");
    expect(handle!.exitReason).toBe("sentinel");
    expect(handle!.totalIterations).toBe(3);
    expect(handle!.cost).toBe(0.12);
    expect(handle!.currentPhase).toBeUndefined();
    expect(handle!.currentIteration).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Partial stream (no session:done = still running)
  // ---------------------------------------------------------------------------

  it("partial stream: no session:done → status is running", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      phaseStart("Phase 1", 1, 3),
      iterationStart(1),
      iterationDone(1),
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("running");
    expect(handle!.exitReason).toBeUndefined();
  });

  it("partial stream: mid-iteration → currentIteration is set", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      phaseStart("Phase 1", 1, 3),
      iterationStart(2, 10),
    ];

    const handle = deriveState(events);
    expect(handle!.currentIteration).toEqual({ iteration: 2, max: 10 });
  });

  it("partial stream: mid-phase → currentPhase is set", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      phaseStart("Phase 2", 2, 5),
    ];

    const handle = deriveState(events);
    expect(handle!.currentPhase).toEqual({ phase: "Phase 2", current: 2, total: 5 });
  });

  // ---------------------------------------------------------------------------
  // Enrichment
  // ---------------------------------------------------------------------------

  it("enrichment-only: status is enriching during enrich:start", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      { type: "enrich:start", timestamp: ts(1), planPath: "/plans/main.md", fileCount: 3 },
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("enriching");
    expect(handle!.enrichProgress).toEqual({ done: 0, total: 3 });
  });

  it("enrichment: tracks file progress", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      { type: "enrich:start", timestamp: ts(1), planPath: "/plans/main.md", fileCount: 3 },
      { type: "enrich:file:start", timestamp: ts(2), file: "a.ts" },
      { type: "enrich:file:done", timestamp: ts(3), file: "a.ts", toolCalls: 2 },
      { type: "enrich:file:start", timestamp: ts(4), file: "b.ts" },
      { type: "enrich:file:skip", timestamp: ts(5), file: "b.ts", reason: "no spec" },
    ];

    const handle = deriveState(events);
    expect(handle!.enrichProgress).toEqual({ done: 2, total: 3 });
  });

  it("enrichment: status returns to running after enrich:done", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      { type: "enrich:start", timestamp: ts(1), planPath: "/plans/main.md", fileCount: 1 },
      { type: "enrich:file:done", timestamp: ts(2), file: "a.ts", toolCalls: 1 },
      { type: "enrich:done", timestamp: ts(3), filesProcessed: 1 },
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("running");
  });

  // ---------------------------------------------------------------------------
  // Error mid-phase
  // ---------------------------------------------------------------------------

  it("error event sets status to error and captures message", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      phaseStart("Phase 1", 1, 2),
      iterationStart(1),
      {
        type: "error",
        timestamp: ts(5),
        message: "Agent timed out",
        phase: "Phase 1",
      },
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("error");
    expect(handle!.error).toBe("Agent timed out");
  });

  // ---------------------------------------------------------------------------
  // Credential expired
  // ---------------------------------------------------------------------------

  it("credential:expired sets status to error with provider info", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      iterationStart(1),
      {
        type: "credential:expired",
        timestamp: ts(5),
        provider: "aws",
        message: "Token expired",
        iteration: 1,
      },
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("error");
    expect(handle!.error).toContain("aws");
    expect(handle!.error).toContain("Token expired");
  });

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  it("verify:start sets status to verifying", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      phaseStart("Phase 1", 1, 1),
      {
        type: "verify:start",
        timestamp: ts(5),
        phase: "Phase 1",
        itemCount: 3,
      },
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("verifying");
    expect(handle!.verifyProgress).toEqual({ passed: 0, total: 3 });
  });

  it("verify:result tracks passed count", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      { type: "verify:start", timestamp: ts(1), phase: "Phase 1", itemCount: 3 },
      {
        type: "verify:result",
        timestamp: ts(2),
        phase: "Phase 1",
        itemId: "item-1",
        command: "bun test",
        passed: true,
      },
      {
        type: "verify:result",
        timestamp: ts(3),
        phase: "Phase 1",
        itemId: "item-2",
        command: "bun test",
        passed: false,
      },
    ];

    const handle = deriveState(events);
    expect(handle!.verifyProgress).toEqual({ passed: 1, total: 3 });
  });

  it("verify:done returns status to running", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      { type: "verify:start", timestamp: ts(1), phase: "Phase 1", itemCount: 2 },
      {
        type: "verify:result",
        timestamp: ts(2),
        phase: "Phase 1",
        itemId: "item-1",
        command: "bun test",
        passed: true,
      },
      {
        type: "verify:done",
        timestamp: ts(3),
        phase: "Phase 1",
        passed: 1,
        failed: 1,
      },
    ];

    const handle = deriveState(events);
    expect(handle!.status).toBe("running");
  });

  // ---------------------------------------------------------------------------
  // Cost tracking
  // ---------------------------------------------------------------------------

  it("cost:update sets cost", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      iterationStart(1),
      {
        type: "cost:update",
        timestamp: ts(2),
        cumulativeCostUsd: 0.15,
        isEstimated: false,
        iteration: 1,
      },
    ];

    const handle = deriveState(events);
    expect(handle!.cost).toBe(0.15);
  });

  it("session:done cost overrides iteration cost", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      iterationDone(1, 0.05),
      sessionDone({ cumulativeCostUsd: 0.20 }),
    ];

    const handle = deriveState(events);
    expect(handle!.cost).toBe(0.20);
  });

  // ---------------------------------------------------------------------------
  // lastEventAt
  // ---------------------------------------------------------------------------

  it("lastEventAt reflects the most recent event timestamp", () => {
    const events: SessionEvent[] = [
      sessionStart(),
      iterationStart(1),
      iterationDone(1),
    ];

    const handle = deriveState(events);
    expect(handle!.lastEventAt).toBe(ts(2)); // iterationDone uses ts(iteration + 1) = ts(2)
  });
});
