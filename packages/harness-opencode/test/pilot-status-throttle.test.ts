// pilot-status-throttle.test.ts — throttle boundary tests for
// src/pilot/mcp/throttle.ts

import { describe, test, expect } from "bun:test";
import { canEmit, recordEmission, type ThrottleState } from "../src/pilot/mcp/throttle.js";

describe("canEmit", () => {
  test("allows first emission for a new key", () => {
    const state: ThrottleState = new Map();
    const result = canEmit(
      { runId: "run1", taskId: "task1" },
      1000,
      state,
      60_000,
    );
    expect(result).toEqual({ ok: true });
  });

  test("allows emission after minInterval has passed", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    // First emission at t=0
    recordEmission(key, 0, state);
    
    // Second emission at t=60s (exactly at boundary)
    const result = canEmit(key, 60_000, state, 60_000);
    expect(result).toEqual({ ok: true });
  });

  test("throttles emission before minInterval has passed", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    // First emission at t=0
    recordEmission(key, 0, state);
    
    // Second emission at t=59s (1s before boundary)
    const result = canEmit(key, 59_000, state, 60_000);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("retryInMs");
    if (!result.ok) {
      expect(result.retryInMs).toBe(1000);
    }
  });

  test("throttle is keyed by (runId, taskId) tuple", () => {
    const state: ThrottleState = new Map();
    
    // Emit for run1/task1 at t=0
    recordEmission({ runId: "run1", taskId: "task1" }, 0, state);
    
    // Emit for run1/task2 at t=30s should be allowed (different task)
    const result1 = canEmit(
      { runId: "run1", taskId: "task2" },
      30_000,
      state,
      60_000,
    );
    expect(result1).toEqual({ ok: true });
    
    // Emit for run2/task1 at t=30s should be allowed (different run)
    const result2 = canEmit(
      { runId: "run2", taskId: "task1" },
      30_000,
      state,
      60_000,
    );
    expect(result2).toEqual({ ok: true });
    
    // Emit for run1/task1 at t=30s should be throttled (same task)
    const result3 = canEmit(
      { runId: "run1", taskId: "task1" },
      30_000,
      state,
      60_000,
    );
    expect(result3.ok).toBe(false);
  });

  test("uses default minInterval of 60s when not specified", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    recordEmission(key, 0, state);
    
    // At 59s should be throttled
    const result1 = canEmit(key, 59_000, state);
    expect(result1.ok).toBe(false);
    
    // At 61s should be allowed
    const result2 = canEmit(key, 61_000, state);
    expect(result2).toEqual({ ok: true });
  });

  test("custom minInterval is respected", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    recordEmission(key, 0, state);
    
    // At 29s with 30s interval should be throttled
    const result1 = canEmit(key, 29_000, state, 30_000);
    expect(result1.ok).toBe(false);
    
    // At 30s with 30s interval should be allowed
    const result2 = canEmit(key, 30_000, state, 30_000);
    expect(result2).toEqual({ ok: true });
  });

  test("retryInMs reports correct wait time at various intervals", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    recordEmission(key, 0, state);
    
    // At 1s, should wait 59s
    const result1 = canEmit(key, 1_000, state, 60_000);
    expect(result1.ok).toBe(false);
    if (!result1.ok) {
      expect(result1.retryInMs).toBe(59_000);
    }
    
    // At 30s, should wait 30s
    const result2 = canEmit(key, 30_000, state, 60_000);
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.retryInMs).toBe(30_000);
    }
    
    // At 59s, should wait 1s
    const result3 = canEmit(key, 59_000, state, 60_000);
    expect(result3.ok).toBe(false);
    if (!result3.ok) {
      expect(result3.retryInMs).toBe(1_000);
    }
  });
});

describe("recordEmission", () => {
  test("records emission timestamp for a key", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    recordEmission(key, 12345, state);
    
    expect(state.get("run1|task1")).toBe(12345);
  });

  test("overwrites previous timestamp on subsequent emissions", () => {
    const state: ThrottleState = new Map();
    const key = { runId: "run1", taskId: "task1" };
    
    recordEmission(key, 1000, state);
    recordEmission(key, 2000, state);
    recordEmission(key, 3000, state);
    
    expect(state.get("run1|task1")).toBe(3000);
  });

  test("uses pipe-delimited key format", () => {
    const state: ThrottleState = new Map();
    
    // These three produce different keys:
    // - {runId: "a", taskId: "b"} -> "a|b"
    // - {runId: "a|b", taskId: "c"} -> "a|b|c"
    // - {runId: "a", taskId: "b|c"} -> "a|b|c" (same as above!)
    recordEmission({ runId: "a", taskId: "b" }, 1000, state);
    recordEmission({ runId: "a|b", taskId: "c" }, 2000, state);
    recordEmission({ runId: "a", taskId: "b|c" }, 3000, state);
    
    // First entry has unique key
    expect(state.get("a|b")).toBe(1000);
    
    // Second and third entries collide on "a|b|c" - last one wins
    // This is expected behavior with simple pipe-delimited keys
    expect(state.get("a|b|c")).toBe(3000);
  });
});
