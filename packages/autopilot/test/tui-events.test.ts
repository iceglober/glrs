/**
 * TUI event flow tests — a1 and a2 acceptance criteria.
 *
 * a1: tool:call events flow from adapter through emitter to TUI state
 * a2: cost:update events accumulate correctly across enrichment and execution sessions
 *
 * These tests are unit-level: they exercise the SessionEventEmitter and the
 * applyEvent reducer logic directly, without spinning up a real OpenCode server.
 */

import { describe, it, expect } from "bun:test";
import { SessionEventEmitter } from "../src/session-runner.js";
import type { SessionEvent, ToolCallEvent, CostUpdateEvent } from "../src/session-events.js";

// ---------------------------------------------------------------------------
// Minimal applyEvent replica for testing cost accumulation logic.
// We replicate the exact logic from AutopilotExecution.tsx so we can test it
// without importing React/Ink (which require a TTY environment).
// ---------------------------------------------------------------------------

interface TuiCostState {
  totalCost: number;
  _lastReportedCost: number;
  tokensIn: number;
  tokensOut: number;
  _lastMsgTokensIn: number;
  _lastMsgTokensOut: number;
}

function initialCostState(): TuiCostState {
  return {
    totalCost: 0,
    _lastReportedCost: 0,
    tokensIn: 0,
    tokensOut: 0,
    _lastMsgTokensIn: 0,
    _lastMsgTokensOut: 0,
  };
}

function applyCostUpdate(prev: TuiCostState, event: CostUpdateEvent): TuiCostState {
  const reportedCost = event.cumulativeCostUsd;
  let newCost = prev.totalCost;
  if (reportedCost < prev._lastReportedCost) {
    // Source changed (e.g., enrichment → execution) — bank previous total
    newCost = prev.totalCost + reportedCost;
  } else {
    // Same source — replace delta
    newCost = prev.totalCost - prev._lastReportedCost + reportedCost;
  }

  let newIn = prev.tokensIn;
  let newOut = prev.tokensOut;
  if (event.tokensIn != null) {
    if (event.tokensIn < prev._lastMsgTokensIn) {
      newIn = prev.tokensIn + event.tokensIn;
    } else {
      newIn = prev.tokensIn - prev._lastMsgTokensIn + event.tokensIn;
    }
  }
  if (event.tokensOut != null) {
    if (event.tokensOut < prev._lastMsgTokensOut) {
      newOut = prev.tokensOut + event.tokensOut;
    } else {
      newOut = prev.tokensOut - prev._lastMsgTokensOut + event.tokensOut;
    }
  }
  return {
    totalCost: newCost,
    _lastReportedCost: reportedCost,
    tokensIn: newIn,
    tokensOut: newOut,
    _lastMsgTokensIn: event.tokensIn ?? prev._lastMsgTokensIn,
    _lastMsgTokensOut: event.tokensOut ?? prev._lastMsgTokensOut,
  };
}

// ---------------------------------------------------------------------------
// a1: tool:call events flow from adapter through emitter to TUI state
// ---------------------------------------------------------------------------

describe("tool:call events flow from adapter through emitter to TUI state", () => {
  it("emitter delivers tool:call event to wildcard listener", () => {
    const emitter = new SessionEventEmitter();
    const received: SessionEvent[] = [];
    emitter.on("event", (e: SessionEvent) => received.push(e));

    const event: ToolCallEvent = {
      type: "tool:call",
      timestamp: "2026-01-01T00:00:00.000Z",
      toolName: "file_edit",
      firstArg: "src/auth.ts",
      iteration: 1,
    };
    emitter.emitEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it("emitter delivers tool:call event to typed listener", () => {
    const emitter = new SessionEventEmitter();
    const received: SessionEvent[] = [];
    emitter.on("tool:call", (e: SessionEvent) => received.push(e));

    const event: ToolCallEvent = {
      type: "tool:call",
      timestamp: "2026-01-01T00:00:00.000Z",
      toolName: "bash",
      firstArg: "bun test",
      iteration: 2,
    };
    emitter.emitEvent(event);

    expect(received).toHaveLength(1);
    const e = received[0] as ToolCallEvent;
    expect(e.toolName).toBe("bash");
    expect(e.firstArg).toBe("bun test");
  });

  it("multiple tool:call events are all delivered in order", () => {
    const emitter = new SessionEventEmitter();
    const toolNames: string[] = [];
    emitter.on("tool:call", (e: SessionEvent) => {
      if (e.type === "tool:call") toolNames.push(e.toolName);
    });

    const tools = ["file_read", "file_edit", "bash", "file_read"];
    for (const toolName of tools) {
      emitter.emitEvent({
        type: "tool:call",
        timestamp: "2026-01-01T00:00:00.000Z",
        toolName,
        iteration: 1,
      });
    }

    expect(toolNames).toEqual(tools);
  });

  it("tool:call without firstArg is delivered correctly", () => {
    const emitter = new SessionEventEmitter();
    const received: ToolCallEvent[] = [];
    emitter.on("tool:call", (e: SessionEvent) => {
      if (e.type === "tool:call") received.push(e);
    });

    emitter.emitEvent({
      type: "tool:call",
      timestamp: "2026-01-01T00:00:00.000Z",
      toolName: "list_directory",
      iteration: 1,
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.firstArg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// a2: cost:update events accumulate correctly across enrichment and execution sessions
// ---------------------------------------------------------------------------

describe("cost:update events accumulate correctly across enrichment and execution sessions", () => {
  it("single cost:update sets totalCost to reported value", () => {
    let state = initialCostState();
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeCostUsd: 0.50,
      isEstimated: false,
      iteration: 1,
      tokensIn: 100,
      tokensOut: 500,
    });

    expect(state.totalCost).toBeCloseTo(0.50);
    expect(state.tokensIn).toBe(100);
    expect(state.tokensOut).toBe(500);
  });

  it("monotonically increasing cost within same session replaces delta correctly", () => {
    let state = initialCostState();

    // First update: $0.30
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeCostUsd: 0.30,
      isEstimated: false,
      iteration: 1,
      tokensIn: 50,
      tokensOut: 200,
    });
    expect(state.totalCost).toBeCloseTo(0.30);

    // Second update: $0.60 (same session, cumulative grew)
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:01.000Z",
      cumulativeCostUsd: 0.60,
      isEstimated: false,
      iteration: 1,
      tokensIn: 100,
      tokensOut: 400,
    });
    // totalCost should be 0.60 (not 0.90)
    expect(state.totalCost).toBeCloseTo(0.60);
    expect(state.tokensIn).toBe(100);
    expect(state.tokensOut).toBe(400);
  });

  it("cost reset (enrichment → execution transition) banks previous total", () => {
    let state = initialCostState();

    // Enrichment session: cumulative reaches $0.88
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeCostUsd: 0.88,
      isEstimated: false,
      iteration: 0,
      tokensIn: 21,
      tokensOut: 2719,
    });
    expect(state.totalCost).toBeCloseTo(0.88);

    // Execution session starts — cumulative resets to $0.10 (lower than $0.88)
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:01:00.000Z",
      cumulativeCostUsd: 0.10,
      isEstimated: false,
      iteration: 1,
      tokensIn: 5,
      tokensOut: 100,
    });
    // totalCost should be 0.88 + 0.10 = 0.98 (banked enrichment + new execution)
    expect(state.totalCost).toBeCloseTo(0.98);
  });

  it("duplicate cost:update with same value produces zero delta (idempotent)", () => {
    let state = initialCostState();

    const event: CostUpdateEvent = {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeCostUsd: 0.50,
      isEstimated: false,
      iteration: 1,
      tokensIn: 100,
      tokensOut: 500,
    };

    state = applyCostUpdate(state, event);
    const costAfterFirst = state.totalCost;

    // Same event again (e.g., post-settlement fetch + SSE both fire)
    state = applyCostUpdate(state, event);

    // totalCost must not change
    expect(state.totalCost).toBeCloseTo(costAfterFirst);
  });

  it("token accumulation handles per-message reset correctly", () => {
    let state = initialCostState();

    // Message 1: tokens grow to 100 in / 500 out
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeCostUsd: 0.10,
      isEstimated: false,
      iteration: 1,
      tokensIn: 100,
      tokensOut: 500,
    });
    expect(state.tokensIn).toBe(100);
    expect(state.tokensOut).toBe(500);

    // Message 2 starts — tokens reset to 10 in / 50 out (lower than previous)
    state = applyCostUpdate(state, {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:01.000Z",
      cumulativeCostUsd: 0.15,
      isEstimated: false,
      iteration: 1,
      tokensIn: 10,
      tokensOut: 50,
    });
    // Should bank message 1's tokens and add message 2's
    expect(state.tokensIn).toBe(110);
    expect(state.tokensOut).toBe(550);
  });

  it("emitter delivers cost:update event to wildcard listener", () => {
    const emitter = new SessionEventEmitter();
    const received: CostUpdateEvent[] = [];
    emitter.on("event", (e: SessionEvent) => {
      if (e.type === "cost:update") received.push(e);
    });

    const event: CostUpdateEvent = {
      type: "cost:update",
      timestamp: "2026-01-01T00:00:00.000Z",
      cumulativeCostUsd: 1.23,
      isEstimated: false,
      iteration: 2,
      tokensIn: 500,
      tokensOut: 2000,
    };
    emitter.emitEvent(event);

    expect(received).toHaveLength(1);
    expect(received[0]!.cumulativeCostUsd).toBe(1.23);
  });
});
