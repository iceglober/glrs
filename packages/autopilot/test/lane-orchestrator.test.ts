/**
 * Tests for the lane-orchestrator module (item 3.3).
 *
 * Uses a deterministic fake `runPhase` that resolves on demand via
 * promise gates — this lets tests verify scheduling decisions without
 * real timers.
 */

import { describe, it, expect } from "bun:test";
import { runLanes, type PhaseResult } from "../src/lane-orchestrator.js";
import { buildConflictGraph } from "../src/conflict-graph.js";
import type { PlanItem } from "../src/plan-parser.js";

function item(id: string, files: string[]): PlanItem {
  return {
    id,
    intent: "",
    files: files.map((p) => ({ path: p, isNew: false, change: "" })),
    tests: [],
    verify: "",
    checked: false,
  };
}

interface Gate {
  resolve: (r: Partial<PhaseResult>) => void;
  promise: Promise<Partial<PhaseResult>>;
}

function makeGate(): Gate {
  let resolve: (r: Partial<PhaseResult>) => void = () => {};
  const promise = new Promise<Partial<PhaseResult>>((res) => {
    resolve = res;
  });
  return { resolve, promise };
}

describe("runLanes", () => {
  it("sequential fallback (laneCount=1) runs phases in input order", async () => {
    const order: string[] = [];
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
      { file: "c.md", items: [item("c", ["src/c.ts"])] },
    ]);
    const result = await runLanes({
      phases: ["a.md", "b.md", "c.md"],
      conflictGraph: graph,
      laneCount: 1,
      runPhase: async (phaseFile, laneId) => {
        order.push(`${laneId}:${phaseFile}`);
        return { phaseFile, laneId, ok: true, iterations: 1, costUsd: 0.01 };
      },
    });
    expect(result.results.map((r) => r.phaseFile)).toEqual(["a.md", "b.md", "c.md"]);
    expect(order).toEqual(["lane-1:a.md", "lane-1:b.md", "lane-1:c.md"]);
    expect(result.skipped).toEqual([]);
  });

  it("dispatches independent phases in parallel up to laneCount", async () => {
    const gates: Record<string, Gate> = {
      "a.md": makeGate(),
      "b.md": makeGate(),
    };
    const inFlightSnapshots: number[] = [];
    let active = 0;
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
    ]);

    const runPromise = runLanes({
      phases: ["a.md", "b.md"],
      conflictGraph: graph,
      laneCount: 2,
      runPhase: async (phaseFile, laneId) => {
        active++;
        inFlightSnapshots.push(active);
        const gate = gates[phaseFile];
        const r = await gate.promise;
        active--;
        return {
          phaseFile,
          laneId,
          ok: true,
          iterations: 1,
          costUsd: 0.01,
          ...r,
        };
      },
    });

    // Yield to the microtask queue so both lanes get dispatched before
    // we resolve any gate.
    await Promise.resolve();
    await Promise.resolve();

    // Both phases should be in flight at this point.
    expect(inFlightSnapshots).toContain(2);

    // Resolve both.
    gates["a.md"].resolve({});
    gates["b.md"].resolve({});

    const result = await runPromise;
    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => r.ok)).toBe(true);
  });

  it("conflicting phases run sequentially even with laneCount=2", async () => {
    const order: string[] = [];
    const startedAt: Record<string, number> = {};
    const finishedAt: Record<string, number> = {};
    let clock = 0;
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/shared.ts"])] },
      { file: "b.md", items: [item("b", ["src/shared.ts"])] },
    ]);

    const result = await runLanes({
      phases: ["a.md", "b.md"],
      conflictGraph: graph,
      laneCount: 2,
      runPhase: async (phaseFile, laneId) => {
        startedAt[phaseFile] = clock++;
        order.push(`start:${phaseFile}`);
        // Yield twice to give the other phase a chance to start (it
        // shouldn't, because they conflict).
        await Promise.resolve();
        await Promise.resolve();
        finishedAt[phaseFile] = clock++;
        order.push(`end:${phaseFile}`);
        return { phaseFile, laneId, ok: true, iterations: 1, costUsd: 0 };
      },
    });

    // a must finish before b starts because they conflict.
    expect(finishedAt["a.md"]).toBeLessThan(startedAt["b.md"]);
    expect(result.results.map((r) => r.phaseFile)).toEqual(["a.md", "b.md"]);
  });

  it("a fatal phase result stops further dispatches", async () => {
    const dispatched: string[] = [];
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
      { file: "c.md", items: [item("c", ["src/c.ts"])] },
    ]);

    const result = await runLanes({
      phases: ["a.md", "b.md", "c.md"],
      conflictGraph: graph,
      laneCount: 1,
      runPhase: async (phaseFile, laneId) => {
        dispatched.push(phaseFile);
        if (phaseFile === "a.md") {
          return {
            phaseFile,
            laneId,
            ok: false,
            fatal: true,
            iterations: 1,
            costUsd: 0,
          };
        }
        return { phaseFile, laneId, ok: true, iterations: 1, costUsd: 0 };
      },
    });

    expect(dispatched).toEqual(["a.md"]);
    expect(result.results.length).toBe(1);
    expect(result.skipped).toEqual(["b.md", "c.md"]);
  });

  it("aborting before any dispatch returns no results and all phases skipped", async () => {
    const ac = new AbortController();
    ac.abort();
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
    ]);
    let called = false;
    const result = await runLanes({
      phases: ["a.md"],
      conflictGraph: graph,
      laneCount: 1,
      abortSignal: ac.signal,
      runPhase: async () => {
        called = true;
        return { phaseFile: "a.md", laneId: "lane-1", ok: true, iterations: 1, costUsd: 0 };
      },
    });
    expect(called).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.skipped).toEqual(["a.md"]);
  });

  it("aborting mid-flight stops new dispatches but lets running phases finish", async () => {
    const gates: Record<string, Gate> = {
      "a.md": makeGate(),
      "b.md": makeGate(),
    };
    const dispatched: string[] = [];
    const ac = new AbortController();
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
    ]);

    const runPromise = runLanes({
      phases: ["a.md", "b.md"],
      conflictGraph: graph,
      laneCount: 1, // sequential — only "a" dispatches initially
      abortSignal: ac.signal,
      runPhase: async (phaseFile, laneId) => {
        dispatched.push(phaseFile);
        const r = await gates[phaseFile].promise;
        return { phaseFile, laneId, ok: true, iterations: 1, costUsd: 0, ...r };
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    // a is dispatched, b is queued.
    expect(dispatched).toEqual(["a.md"]);

    // Abort while a is still in flight.
    ac.abort();

    // a finishes — but b should NOT dispatch.
    gates["a.md"].resolve({});
    const result = await runPromise;
    expect(dispatched).toEqual(["a.md"]);
    expect(result.results.length).toBe(1);
    expect(result.skipped).toEqual(["b.md"]);
  });

  it("reuses lane ids across waves of phases (lane-1 finishes, next phase picks lane-1)", async () => {
    const laneAssignments: string[] = [];
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
      { file: "c.md", items: [item("c", ["src/c.ts"])] },
    ]);

    await runLanes({
      phases: ["a.md", "b.md", "c.md"],
      conflictGraph: graph,
      laneCount: 1,
      runPhase: async (phaseFile, laneId) => {
        laneAssignments.push(`${phaseFile}=${laneId}`);
        return { phaseFile, laneId, ok: true, iterations: 1, costUsd: 0 };
      },
    });

    // All three sequential phases must run on lane-1.
    expect(laneAssignments).toEqual([
      "a.md=lane-1",
      "b.md=lane-1",
      "c.md=lane-1",
    ]);
  });

  it("returns empty results for empty phase list", async () => {
    const graph = buildConflictGraph([]);
    const result = await runLanes({
      phases: [],
      conflictGraph: graph,
      laneCount: 2,
      runPhase: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.results).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("emits scheduling logs to the optional logger", async () => {
    const logs: Array<{ obj: unknown; msg?: string }> = [];
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
    ]);
    await runLanes({
      phases: ["a.md"],
      conflictGraph: graph,
      laneCount: 1,
      logger: {
        info: (obj, msg) => logs.push({ obj, msg }),
      },
      runPhase: async (phaseFile, laneId) => ({
        phaseFile,
        laneId,
        ok: true,
        iterations: 1,
        costUsd: 0,
      }),
    });
    // Should see at least a "dispatch" and a "completed" log.
    expect(logs.some((l) => l.msg?.includes("dispatch"))).toBe(true);
    expect(logs.some((l) => l.msg?.includes("completed"))).toBe(true);
  });
});
