/**
 * Tests for the YAML spec parser (spec-parser.ts) and schema validation
 * (spec-schema.ts).
 *
 * Covers:
 *   - Parsing spec/main.yaml into PlanState
 *   - Parsing spec/wave_0.yaml into PlanItem[]
 *   - Checked state from YAML `checked: true`
 *   - Enrichment fields (mirror, context, conventions)
 *   - Schema validation errors for malformed YAML
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseSpecState,
  parseSpecItems,
  hasSpec,
} from "../src/spec-parser.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-parser-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSpec(planDir: string, filename: string, content: string): void {
  const specDir = path.join(planDir, "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, filename), content, "utf-8");
}

// ---------------------------------------------------------------------------
// hasSpec
// ---------------------------------------------------------------------------

describe("hasSpec", () => {
  it("returns false when no spec directory exists", () => {
    expect(hasSpec(tmpDir)).toBe(false);
  });

  it("returns false when spec/ exists but no main.yaml", () => {
    fs.mkdirSync(path.join(tmpDir, "spec"));
    expect(hasSpec(tmpDir)).toBe(false);
  });

  it("returns true when spec/main.yaml exists", () => {
    writeSpec(tmpDir, "main.yaml", "title: Test\nphases: []\n");
    expect(hasSpec(tmpDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSpecState — main.yaml parsing
// ---------------------------------------------------------------------------

describe("parseSpecState", () => {
  it("parses main.yaml into PlanState with phases", () => {
    writeSpec(
      tmpDir,
      "main.yaml",
      `title: My Feature
goal: Implement the feature
phases:
  - file: wave_0.yaml
    completed: false
  - file: wave_1.yaml
    completed: true
`,
    );
    writeSpec(
      tmpDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: First item
    checked: false
  - id: a2
    intent: Second item
    checked: true
`,
    );
    writeSpec(
      tmpDir,
      "wave_1.yaml",
      `items:
  - id: b1
    intent: Third item
    checked: true
`,
    );

    const state = parseSpecState(tmpDir);
    expect(state.type).toBe("multi");
    expect(state.phaseCount).toBe(2);
    expect(state.phasesCompleted).toBe(1);
    expect(state.phases).toHaveLength(2);
    expect(state.phases[0]).toEqual({
      file: "wave_0.yaml",
      totalItems: 2,
      checkedItems: 1,
    });
    expect(state.phases[1]).toEqual({
      file: "wave_1.yaml",
      totalItems: 1,
      checkedItems: 1,
    });
    // totalItems and checkedItems are summed across all phases
    expect(state.totalItems).toBe(3);
    expect(state.checkedItems).toBe(2);
  });

  it("returns degraded state when spec/main.yaml is missing", () => {
    const state = parseSpecState(tmpDir);
    expect(state.type).toBe("single");
    expect(state.totalItems).toBe(0);
    expect(state.checkedItems).toBe(0);
  });

  it("handles empty phases array", () => {
    writeSpec(tmpDir, "main.yaml", "title: Empty\nphases: []\n");
    const state = parseSpecState(tmpDir);
    expect(state.type).toBe("multi");
    expect(state.phaseCount).toBe(0);
    expect(state.phasesCompleted).toBe(0);
    expect(state.phases).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSpecItems — phase YAML parsing
// ---------------------------------------------------------------------------

describe("parseSpecItems", () => {
  it("parses phase YAML into PlanItem array with all fields", () => {
    writeSpec(
      tmpDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Add the widget factory
    checked: false
    files:
      - path: src/widgets/factory.ts
        isNew: true
        change: Create the WidgetFactory class
      - path: src/widgets/index.ts
        isNew: false
        change: Re-export WidgetFactory
    tests:
      - test/widget-factory.test.ts::"creates a widget"
    verify: bun test test/widget-factory.test.ts
`,
    );

    const phasePath = path.join(tmpDir, "spec", "wave_0.yaml");
    const items = parseSpecItems(phasePath);
    expect(items).toHaveLength(1);

    const a1 = items[0];
    expect(a1.id).toBe("a1");
    expect(a1.intent).toBe("Add the widget factory");
    expect(a1.checked).toBe(false);
    expect(a1.files).toHaveLength(2);
    expect(a1.files[0].path).toBe("src/widgets/factory.ts");
    expect(a1.files[0].isNew).toBe(true);
    expect(a1.files[0].change).toBe("Create the WidgetFactory class");
    expect(a1.files[1].path).toBe("src/widgets/index.ts");
    expect(a1.files[1].isNew).toBe(false);
    expect(a1.tests).toEqual(['test/widget-factory.test.ts::"creates a widget"']);
    expect(a1.verify).toBe("bun test test/widget-factory.test.ts");
  });

  it("marks items checked when YAML has checked: true", () => {
    writeSpec(
      tmpDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Done item
    checked: true
  - id: a2
    intent: Pending item
    checked: false
`,
    );

    const phasePath = path.join(tmpDir, "spec", "wave_0.yaml");
    const items = parseSpecItems(phasePath);
    expect(items[0].checked).toBe(true);
    expect(items[1].checked).toBe(false);
  });

  it("handles enrichment fields (mirror, context, conventions)", () => {
    writeSpec(
      tmpDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Enriched item
    checked: false
    mirror: src/existing/similar.ts
    context: "function foo() { return 42; }"
    conventions: bun:test, named exports
`,
    );

    const phasePath = path.join(tmpDir, "spec", "wave_0.yaml");
    const items = parseSpecItems(phasePath);
    expect(items[0].mirror).toBe("src/existing/similar.ts");
    expect(items[0].context).toBe("function foo() { return 42; }");
    expect(items[0].conventions).toBe("bun:test, named exports");
  });

  it("returns empty array for non-existent file", () => {
    const items = parseSpecItems("/nonexistent/path/wave_0.yaml");
    expect(items).toEqual([]);
  });

  it("returns empty array when items field is missing", () => {
    writeSpec(tmpDir, "wave_0.yaml", "title: No items here\n");
    const phasePath = path.join(tmpDir, "spec", "wave_0.yaml");
    const items = parseSpecItems(phasePath);
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schema validation (a2)
// ---------------------------------------------------------------------------

describe("schema validation", () => {
  it("rejects YAML missing required items field", async () => {
    writeSpec(tmpDir, "wave_0.yaml", "title: Missing items\n");
    const phasePath = path.join(tmpDir, "spec", "wave_0.yaml");
    // parseSpecItems returns [] for missing items (graceful degradation)
    // but validatePhaseSpec should throw/return error
    const { validatePhaseSpec } = await import(
      "../src/spec-schema.js"
    );
    const result = validatePhaseSpec({ title: "Missing items" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/items/);
  });

  it("rejects item missing required id field", async () => {
    const { validatePhaseSpec } = await import(
      "../src/spec-schema.js"
    );
    const result = validatePhaseSpec({
      items: [{ intent: "No id here", checked: false }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("id"))).toBe(true);
  });

  it("rejects item missing required intent field", async () => {
    const { validatePhaseSpec } = await import(
      "../src/spec-schema.js"
    );
    const result = validatePhaseSpec({
      items: [{ id: "a1", checked: false }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("intent"))).toBe(true);
  });

  it("accepts valid phase spec", async () => {
    const { validatePhaseSpec } = await import(
      "../src/spec-schema.js"
    );
    const result = validatePhaseSpec({
      items: [{ id: "a1", intent: "Do the thing", checked: false }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validates main spec — rejects missing phases field", async () => {
    const { validateMainSpec } = await import(
      "../src/spec-schema.js"
    );
    const result = validateMainSpec({ title: "No phases" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("phases"))).toBe(true);
  });

  it("validates main spec — accepts valid structure", async () => {
    const { validateMainSpec } = await import(
      "../src/spec-schema.js"
    );
    const result = validateMainSpec({
      title: "My Plan",
      phases: [{ file: "wave_0.yaml", completed: false }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
