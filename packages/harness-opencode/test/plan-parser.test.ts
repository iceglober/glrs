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
import { parsePlanState } from "../src/autopilot/plan-parser.js";

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
