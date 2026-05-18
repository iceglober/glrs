/**
 * Tests for the plan-parser module.
 *
 * Covers:
 *   - Single-file plan checkbox state parsing
 *   - Multi-file plan (main.md + phase files) parsing
 *   - Fenced plan-state block item counting
 *   - Plain checkbox parsing (- [ ] / - [x])
 *   - Malformed input degradation (never throws)
 *   - Path-type detection (file vs directory)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parsePlanState, parseItems } from "../src/plan-parser.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-parser-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parsePlanState — single-file plans", () => {
  it("parses single-file plan checkbox state", () => {
    const planPath = path.join(tmpDir, "my-plan.md");
    fs.writeFileSync(
      planPath,
      `# My Plan

## Acceptance criteria

- [x] First item done
- [ ] Second item pending
- [x] Third item done
`,
    );

    const result = parsePlanState(planPath);
    expect(result.type).toBe("single");
    expect(result.totalItems).toBe(3);
    expect(result.checkedItems).toBe(2);
    expect(result.phaseCount).toBe(0);
    expect(result.phasesCompleted).toBe(0);
    expect(result.phases).toEqual([]);
  });

  it("counts fenced plan-state items correctly", () => {
    const planPath = path.join(tmpDir, "fenced-plan.md");
    fs.writeFileSync(
      planPath,
      `# Fenced Plan

## Acceptance criteria

\`\`\`plan-state
- [x] id: a1
  intent: First item
  tests:
    - test/foo.test.ts::"test one"
  verify: bun test test/foo.test.ts

- [ ] id: a2
  intent: Second item
  tests:
    - test/bar.test.ts::"test two"
  verify: bun test test/bar.test.ts

- [x] id: a3
  intent: Third item
  tests:
    - test/baz.test.ts::"test three"
  verify: bun test test/baz.test.ts
\`\`\`
`,
    );

    const result = parsePlanState(planPath);
    expect(result.type).toBe("single");
    expect(result.totalItems).toBe(3);
    expect(result.checkedItems).toBe(2);
  });

  it("detects plan type from path (file vs directory)", () => {
    const planPath = path.join(tmpDir, "single.md");
    fs.writeFileSync(planPath, "# Plan\n\n- [ ] item\n");

    const result = parsePlanState(planPath);
    expect(result.type).toBe("single");
  });
});

describe("parsePlanState — multi-file plans", () => {
  it("parses multi-file plan with main.md and phase files", () => {
    const planDir = path.join(tmpDir, "my-feature");
    fs.mkdirSync(planDir);

    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature

## Phases

- [x] phase_1.md — Phase 1: Setup
- [ ] phase_2.md — Phase 2: Implementation
- [ ] phase_3.md — Phase 3: Testing

## Cross-cutting acceptance criteria

- [x] Changeset exists
`,
    );

    fs.writeFileSync(
      path.join(planDir, "phase_1.md"),
      `# Phase 1

## Acceptance criteria

- [x] Setup done
- [x] Config ready
`,
    );

    fs.writeFileSync(
      path.join(planDir, "phase_2.md"),
      `# Phase 2

## Acceptance criteria

- [ ] Feature implemented
- [ ] Tests written
- [ ] Types clean
`,
    );

    fs.writeFileSync(
      path.join(planDir, "phase_3.md"),
      `# Phase 3

## Acceptance criteria

- [ ] Integration tests pass
`,
    );

    const result = parsePlanState(planDir);
    expect(result.type).toBe("multi");
    expect(result.phaseCount).toBe(3);
    expect(result.phasesCompleted).toBe(1);
    // main.md checkboxes: 3 phase refs + 1 cross-cutting = 4 total, 2 checked
    // (phase_1.md ref is [x] and "Changeset exists" is [x])
    expect(result.totalItems).toBe(4);
    expect(result.checkedItems).toBe(2);
    expect(result.phases).toHaveLength(3);
    expect(result.phases[0]).toEqual({ file: "phase_1.md", totalItems: 2, checkedItems: 2 });
    expect(result.phases[1]).toEqual({ file: "phase_2.md", totalItems: 3, checkedItems: 0 });
    expect(result.phases[2]).toEqual({ file: "phase_3.md", totalItems: 1, checkedItems: 0 });
  });

  it("detects plan type from path (file vs directory)", () => {
    const planDir = path.join(tmpDir, "multi-plan");
    fs.mkdirSync(planDir);
    fs.writeFileSync(path.join(planDir, "main.md"), "# Plan\n\n- [ ] item\n");

    const result = parsePlanState(planDir);
    expect(result.type).toBe("multi");
  });
});

describe("parsePlanState — degradation", () => {
  it("degrades gracefully on malformed plan content", () => {
    const planPath = path.join(tmpDir, "malformed.md");
    fs.writeFileSync(planPath, "this is not a valid plan\n\x00\x01\x02");

    // Must not throw
    const result = parsePlanState(planPath);
    expect(result.type).toBe("single");
    expect(result.totalItems).toBe(0);
    expect(result.checkedItems).toBe(0);
    expect(result.phaseCount).toBe(0);
    expect(result.phasesCompleted).toBe(0);
    expect(result.phases).toEqual([]);
  });

  it("degrades gracefully on non-existent path", () => {
    const result = parsePlanState(path.join(tmpDir, "does-not-exist.md"));
    expect(result.totalItems).toBe(0);
    expect(result.checkedItems).toBe(0);
    expect(result.phaseCount).toBe(0);
    expect(result.phasesCompleted).toBe(0);
  });

  it("degrades gracefully on empty file", () => {
    const planPath = path.join(tmpDir, "empty.md");
    fs.writeFileSync(planPath, "");

    const result = parsePlanState(planPath);
    expect(result.totalItems).toBe(0);
    expect(result.checkedItems).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseItems — structured item extraction from plan-state fences
// ---------------------------------------------------------------------------

describe("parseItems", () => {
  const PLAN_WITH_FILES = `
## Acceptance criteria

\`\`\`plan-state
- [ ] id: a1
  intent: Add the widget factory
  files:
    - src/widgets/factory.ts (NEW)
      Change: Create the WidgetFactory class with a create() method
    - src/widgets/index.ts
      Change: Re-export WidgetFactory from the barrel
  tests:
    - test/widget-factory.test.ts::"creates a widget"
    - test/widget-factory.test.ts::"returns null for unknown type"
  verify: bun test test/widget-factory.test.ts

- [x] id: a2
  intent: Update the docs
  files:
    - docs/widgets.md
      Change: Document the new factory API
  tests:
    - test/docs.test.ts::"docs mention factory"
  verify: bun test test/docs.test.ts
\`\`\`
`;

  const PLAN_WITHOUT_FILES = `
## Acceptance criteria

\`\`\`plan-state
- [ ] id: b1
  intent: Simple item with no files field
  tests:
    - test/simple.test.ts::"passes"
  verify: bun test test/simple.test.ts
\`\`\`
`;

  it("parseItems extracts files field with path and change", () => {
    const items = parseItems(PLAN_WITH_FILES);
    expect(items).toHaveLength(2);

    const a1 = items[0];
    expect(a1.id).toBe("a1");
    expect(a1.files).toHaveLength(2);
    expect(a1.files[0].path).toBe("src/widgets/factory.ts");
    expect(a1.files[0].change).toBe(
      "Create the WidgetFactory class with a create() method",
    );
    expect(a1.files[1].path).toBe("src/widgets/index.ts");
    expect(a1.files[1].change).toBe(
      "Re-export WidgetFactory from the barrel",
    );
  });

  it("parseItems marks NEW files with isNew flag", () => {
    const items = parseItems(PLAN_WITH_FILES);
    const a1 = items[0];

    expect(a1.files[0].isNew).toBe(true);   // factory.ts (NEW)
    expect(a1.files[1].isNew).toBe(false);  // index.ts (no NEW marker)
  });

  it("parseItems returns empty files array when field is absent", () => {
    const items = parseItems(PLAN_WITHOUT_FILES);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b1");
    expect(items[0].files).toEqual([]);
  });

  it("parseItems extracts all fields (id, intent, files, tests, verify, checked)", () => {
    const items = parseItems(PLAN_WITH_FILES);

    // a1 — unchecked
    const a1 = items[0];
    expect(a1.id).toBe("a1");
    expect(a1.intent).toBe("Add the widget factory");
    expect(a1.tests).toEqual([
      'test/widget-factory.test.ts::"creates a widget"',
      'test/widget-factory.test.ts::"returns null for unknown type"',
    ]);
    expect(a1.verify).toBe("bun test test/widget-factory.test.ts");
    expect(a1.checked).toBe(false);

    // a2 — checked
    const a2 = items[1];
    expect(a2.id).toBe("a2");
    expect(a2.checked).toBe(true);
    expect(a2.files[0].path).toBe("docs/widgets.md");
    expect(a2.files[0].isNew).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// YAML routing (a4) — parsePlanState routes to YAML parser when spec/ exists
// ---------------------------------------------------------------------------

describe("parsePlanState — YAML routing", () => {
  it("routes to YAML parser when spec directory exists", () => {
    const planDir = path.join(tmpDir, "yaml-plan");
    fs.mkdirSync(planDir);
    fs.mkdirSync(path.join(planDir, "spec"));

    // Write spec/main.yaml
    fs.writeFileSync(
      path.join(planDir, "spec", "main.yaml"),
      `title: YAML Plan
phases:
  - file: wave_0.yaml
    completed: false
`,
      "utf-8",
    );

    // Write spec/wave_0.yaml
    fs.writeFileSync(
      path.join(planDir, "spec", "wave_0.yaml"),
      `items:
  - id: a1
    intent: First item
    checked: true
  - id: a2
    intent: Second item
    checked: false
`,
      "utf-8",
    );

    const result = parsePlanState(planDir);
    expect(result.type).toBe("multi");
    expect(result.totalItems).toBe(2);
    expect(result.checkedItems).toBe(1);
    expect(result.phaseCount).toBe(1);
    expect(result.phasesCompleted).toBe(0);
  });

  it("falls back to markdown parser when no spec directory", () => {
    const planDir = path.join(tmpDir, "md-plan");
    fs.mkdirSync(planDir);

    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Plan

## Phases

- [ ] phase_1.md

`,
    );
    fs.writeFileSync(
      path.join(planDir, "phase_1.md"),
      `# Phase 1

- [x] Item done
- [ ] Item pending
`,
    );

    const result = parsePlanState(planDir);
    expect(result.type).toBe("multi");
    // Markdown parser counts checkboxes in main.md (1 phase ref)
    expect(result.phaseCount).toBe(1);
  });

  it("parsePlanState returns identical shape from YAML and markdown", () => {
    // Both paths must return a PlanState with the same field set
    const yamlDir = path.join(tmpDir, "yaml-shape");
    fs.mkdirSync(yamlDir);
    fs.mkdirSync(path.join(yamlDir, "spec"));
    fs.writeFileSync(
      path.join(yamlDir, "spec", "main.yaml"),
      `title: Shape Test
phases:
  - file: wave_0.yaml
    completed: true
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(yamlDir, "spec", "wave_0.yaml"),
      `items:
  - id: a1
    intent: Done
    checked: true
`,
      "utf-8",
    );

    const mdDir = path.join(tmpDir, "md-shape");
    fs.mkdirSync(mdDir);
    fs.writeFileSync(
      path.join(mdDir, "main.md"),
      `# Shape Test

- [x] phase_1.md
`,
    );
    fs.writeFileSync(
      path.join(mdDir, "phase_1.md"),
      `# Phase 1

- [x] Done
`,
    );

    const yamlResult = parsePlanState(yamlDir);
    const mdResult = parsePlanState(mdDir);

    // Both must have the same shape (same keys)
    const yamlKeys = Object.keys(yamlResult).sort();
    const mdKeys = Object.keys(mdResult).sort();
    expect(yamlKeys).toEqual(mdKeys);

    // Both must be "multi" type
    expect(yamlResult.type).toBe("multi");
    expect(mdResult.type).toBe("multi");
  });
});
