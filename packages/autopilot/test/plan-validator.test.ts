import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validatePlan } from "../src/plan-validator.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-validator-test-"));
}

function writeSpec(planDir: string, filename: string, content: string): void {
  const specDir = path.join(planDir, "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, filename), content, "utf-8");
}

describe("validatePlan — missing/file plans", () => {
  it("returns missing-plan error when path doesn't exist", () => {
    const r = validatePlan("/nonexistent/path");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.code).toBe("missing-plan");
  });

  it("returns requires-enrichment for a single file", () => {
    const dir = tmpDir();
    const f = path.join(dir, "plan.md");
    fs.writeFileSync(f, "# Plan\n\nSome prose.\n");
    const r = validatePlan(f);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.code).toBe("requires-enrichment");
  });
});

describe("validatePlan — directory plans", () => {
  it("returns missing-spec error when directory has no spec/", () => {
    const dir = tmpDir();
    const r = validatePlan(dir);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.code).toBe("missing-spec");
  });

  it("returns no errors for valid spec", () => {
    const dir = tmpDir();
    writeSpec(dir, "main.yaml", `title: My Plan\nphases:\n  - file: wave_0.yaml\n    completed: false\n`);
    writeSpec(dir, "wave_0.yaml", `items:\n  - id: a1\n    intent: Do the thing\n    checked: false\n    files:\n      - path: src/foo.ts\n        isNew: false\n        change: edit it\n    tests:\n      - test/foo.test.ts\n    verify: bun test\n`);
    const r = validatePlan(dir);
    expect(r.errors).toEqual([]);
  });

  it("flags missing phase files referenced in spec/main.yaml", () => {
    const dir = tmpDir();
    writeSpec(dir, "main.yaml", `title: My Plan\nphases:\n  - file: wave_0.yaml\n    completed: false\n  - file: wave_1.yaml\n    completed: false\n`);
    writeSpec(dir, "wave_0.yaml", `items:\n  - id: a1\n    intent: Do thing\n    checked: false\n`);
    // wave_1.yaml is missing
    const r = validatePlan(dir);
    expect(r.errors.some((e) => e.code === "missing-spec-phase-file")).toBe(true);
  });

  it("reports invalid-spec-main for missing phases field", () => {
    const dir = tmpDir();
    writeSpec(dir, "main.yaml", "title: My Plan\n");
    const r = validatePlan(dir);
    expect(r.errors.some((e) => e.code === "invalid-spec-main")).toBe(true);
  });

  it("reports invalid-spec-phase for item without intent", () => {
    const dir = tmpDir();
    writeSpec(dir, "main.yaml", `title: My Plan\nphases:\n  - file: wave_0.yaml\n    completed: false\n`);
    writeSpec(dir, "wave_0.yaml", `items:\n  - id: a1\n    checked: false\n`);
    const r = validatePlan(dir);
    expect(r.errors.some((e) => e.code === "invalid-spec-phase")).toBe(true);
  });
});

describe("validatePlan — never throws", () => {
  it("degrades to a report on filesystem-stat failure", () => {
    expect(() => validatePlan("/totally/missing/path")).not.toThrow();
  });
});
