/**
 * Tests for the conflict-graph module (item 3.1).
 */

import { describe, it, expect } from "bun:test";
import {
  buildConflictGraph,
  findIndependentPhases,
  hasParallelism,
} from "../src/conflict-graph.js";
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

describe("buildConflictGraph", () => {
  it("treats disjoint file sets as non-conflicting", () => {
    const graph = buildConflictGraph([
      { file: "wave_1.md", items: [item("1.1", ["src/a.ts"])] },
      { file: "wave_2.md", items: [item("2.1", ["src/b.ts"])] },
    ]);
    expect(graph.phases).toEqual(["wave_1.md", "wave_2.md"]);
    expect(graph.conflicts.get("wave_1.md")?.size).toBe(0);
    expect(graph.conflicts.get("wave_2.md")?.size).toBe(0);
  });

  it("flags phases that share at least one file as conflicting", () => {
    const graph = buildConflictGraph([
      { file: "wave_1.md", items: [item("1.1", ["src/a.ts", "src/shared.ts"])] },
      { file: "wave_2.md", items: [item("2.1", ["src/b.ts", "src/shared.ts"])] },
    ]);
    expect(graph.conflicts.get("wave_1.md")?.has("wave_2.md")).toBe(true);
    expect(graph.conflicts.get("wave_2.md")?.has("wave_1.md")).toBe(true);
  });

  it("conservative: phases with zero items conflict with everything", () => {
    const graph = buildConflictGraph([
      { file: "wave_1.md", items: [] },
      { file: "wave_2.md", items: [item("2.1", ["src/b.ts"])] },
      { file: "wave_3.md", items: [item("3.1", ["src/c.ts"])] },
    ]);
    expect(graph.conflicts.get("wave_1.md")?.has("wave_2.md")).toBe(true);
    expect(graph.conflicts.get("wave_1.md")?.has("wave_3.md")).toBe(true);
    // wave_2 and wave_3 still don't conflict with each other.
    expect(graph.conflicts.get("wave_2.md")?.has("wave_3.md")).toBe(false);
  });

  it("conservative: phases whose items declare no files conflict with everything", () => {
    const graph = buildConflictGraph([
      { file: "wave_1.md", items: [item("1.1", [])] },
      { file: "wave_2.md", items: [item("2.1", ["src/b.ts"])] },
    ]);
    expect(graph.conflicts.get("wave_1.md")?.has("wave_2.md")).toBe(true);
    expect(graph.conflicts.get("wave_2.md")?.has("wave_1.md")).toBe(true);
  });

  it("does not record self-conflicts", () => {
    const graph = buildConflictGraph([
      { file: "wave_1.md", items: [item("1.1", ["src/a.ts"])] },
    ]);
    expect(graph.conflicts.get("wave_1.md")?.has("wave_1.md")).toBe(false);
  });

  it("aggregates files across multiple items in a phase", () => {
    const graph = buildConflictGraph([
      {
        file: "wave_1.md",
        items: [item("1.1", ["src/a.ts"]), item("1.2", ["src/shared.ts"])],
      },
      { file: "wave_2.md", items: [item("2.1", ["src/shared.ts"])] },
    ]);
    expect(graph.conflicts.get("wave_1.md")?.has("wave_2.md")).toBe(true);
  });
});

describe("findIndependentPhases", () => {
  it("returns one group per phase when all conflict", () => {
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/x.ts"])] },
      { file: "b.md", items: [item("b", ["src/x.ts"])] },
      { file: "c.md", items: [item("c", ["src/x.ts"])] },
    ]);
    const groups = findIndependentPhases(graph);
    expect(groups.length).toBe(3);
    expect(groups.map((g) => g.length)).toEqual([1, 1, 1]);
  });

  it("groups all phases when none conflict", () => {
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
      { file: "c.md", items: [item("c", ["src/c.ts"])] },
    ]);
    const groups = findIndependentPhases(graph);
    expect(groups).toEqual([["a.md", "b.md", "c.md"]]);
  });

  it("partitions correctly when some phases conflict", () => {
    // a and b share x.ts; c is independent of both
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/x.ts"])] },
      { file: "b.md", items: [item("b", ["src/x.ts"])] },
      { file: "c.md", items: [item("c", ["src/c.ts"])] },
    ]);
    const groups = findIndependentPhases(graph);
    // Group 1: [a, c]; group 2: [b] (greedy places c with a since they don't conflict).
    expect(groups.length).toBe(2);
    expect(groups[0]).toContain("a.md");
    expect(groups[0]).toContain("c.md");
    expect(groups[1]).toEqual(["b.md"]);
  });

  it("preserves input order within groups", () => {
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
    ]);
    const groups = findIndependentPhases(graph);
    expect(groups[0]).toEqual(["a.md", "b.md"]);
  });

  it("handles empty input", () => {
    const graph = buildConflictGraph([]);
    expect(findIndependentPhases(graph)).toEqual([]);
  });
});

describe("hasParallelism", () => {
  it("returns false when every phase conflicts with every other", () => {
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/x.ts"])] },
      { file: "b.md", items: [item("b", ["src/x.ts"])] },
    ]);
    expect(hasParallelism(graph)).toBe(false);
  });

  it("returns true when at least two phases are independent", () => {
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
      { file: "b.md", items: [item("b", ["src/b.ts"])] },
    ]);
    expect(hasParallelism(graph)).toBe(true);
  });

  it("returns false for empty input", () => {
    const graph = buildConflictGraph([]);
    expect(hasParallelism(graph)).toBe(false);
  });

  it("returns false for a single phase (no opportunity for parallelism)", () => {
    const graph = buildConflictGraph([
      { file: "a.md", items: [item("a", ["src/a.ts"])] },
    ]);
    expect(hasParallelism(graph)).toBe(false);
  });
});
