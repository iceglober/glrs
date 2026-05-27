/**
 * Tests for plan-validator's YAML path (a7).
 *
 * Covers:
 *   - validates YAML spec structure when spec directory exists
 *   - reports error for missing phases in main.yaml
 *   - reports error for item without intent in phase YAML
 *   - returns missing-spec error without spec directory
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validatePlan } from "../src/plan-validator.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-validator-yaml-test-"));
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
// YAML spec validation
// ---------------------------------------------------------------------------

describe("plan-validator YAML path", () => {
  it("validates YAML spec structure when spec directory exists", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    // Write a valid spec
    writeSpec(
      planDir,
      "main.yaml",
      `title: My Plan
phases:
  - file: wave_0.yaml
    completed: false
`,
    );
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Do the thing
    checked: false
    files:
      - path: src/foo.ts
        isNew: false
        change: edit it
    tests:
      - test/foo.test.ts::"passes"
    verify: bun test
`,
    );

    const report = validatePlan(planDir);
    expect(report.errors).toEqual([]);
  });

  it("reports error for missing phases in main.yaml", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    // Write an invalid main.yaml (missing phases field)
    writeSpec(planDir, "main.yaml", "title: My Plan\n");

    const report = validatePlan(planDir);
    expect(report.errors.some((e) => e.code === "invalid-spec-main")).toBe(true);
  });

  it("reports error for item without intent in phase YAML", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Plan
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    // wave_0.yaml has an item missing intent
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    checked: false
`,
    );

    const report = validatePlan(planDir);
    expect(report.errors.some((e) => e.code === "invalid-spec-phase")).toBe(true);
  });

  it("falls back to markdown validation without spec directory", () => {
    // No spec/ directory → should return missing-spec error
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    const report = validatePlan(planDir);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.code).toBe("missing-spec");
  });
});
