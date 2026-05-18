/**
 * Tests for the plan-validator module (item 4.5).
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validatePlan } from "../src/plan-validator.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-validator-test-"));
}

function writePlanFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

const PHASE_WITH_FENCE = `# Phase 1

## Items

- [ ] 1.1 **First item**

\`\`\`plan-state
- [ ] id: 1.1
  intent: do the thing
  files:
    - src/foo.ts
      Change: edit it
  tests:
    - tests pass
  verify: bun test
\`\`\`
`;

const PHASE_NO_INTENT = `# Phase 1

\`\`\`plan-state
- [ ] id: 1.1
  files:
    - src/foo.ts
      Change: edit it
  verify: bun test
\`\`\`
`;

const PHASE_MISSING_FIELDS = `# Phase 1

\`\`\`plan-state
- [ ] id: 1.1
  intent: do the thing
\`\`\`
`;

describe("validatePlan — directory plans", () => {
  it("returns missing-plan error when path doesn't exist", () => {
    const r = validatePlan("/nonexistent/path");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.code).toBe("missing-plan");
  });

  it("returns missing-main error when directory has no main.md", () => {
    const dir = tmpDir();
    const r = validatePlan(dir);
    expect(r.errors[0]?.code).toBe("missing-main");
  });

  it("flags phase files referenced in main.md but missing on disk", () => {
    const dir = tmpDir();
    writePlanFile(
      dir,
      "main.md",
      `# Goal

## Phases

- [ ] phase_1.md
- [ ] phase_2.md
`,
    );
    writePlanFile(dir, "phase_1.md", PHASE_WITH_FENCE);
    // phase_2.md not written

    const r = validatePlan(dir);
    expect(r.errors.some((e) => e.code === "missing-phase-file")).toBe(true);
    expect(r.errors.find((e) => e.code === "missing-phase-file")?.file).toBe(
      "phase_2.md",
    );
  });

  it("returns no errors when all phase files exist with intents", () => {
    const dir = tmpDir();
    writePlanFile(
      dir,
      "main.md",
      `# Goal

## Phases

- [ ] phase_1.md
`,
    );
    writePlanFile(dir, "phase_1.md", PHASE_WITH_FENCE);

    const r = validatePlan(dir);
    expect(r.errors).toEqual([]);
  });

  it("flags phase files with items but no intents as an error", () => {
    const dir = tmpDir();
    writePlanFile(
      dir,
      "main.md",
      `## Phases

- [ ] phase_1.md
`,
    );
    writePlanFile(dir, "phase_1.md", PHASE_NO_INTENT);

    const r = validatePlan(dir);
    expect(r.errors.some((e) => e.code === "no-intent-in-phase")).toBe(true);
  });

  it("emits soft warnings for items missing files/tests/verify", () => {
    const dir = tmpDir();
    writePlanFile(
      dir,
      "main.md",
      `## Phases

- [ ] phase_1.md
`,
    );
    writePlanFile(dir, "phase_1.md", PHASE_MISSING_FIELDS);

    const r = validatePlan(dir);
    const codes = r.warnings.map((w) => w.code).sort();
    expect(codes).toContain("missing-files");
    expect(codes).toContain("missing-tests");
    expect(codes).toContain("missing-verify");
  });
});

describe("validatePlan — single-file plans", () => {
  it("returns no errors for a single-file plan with a complete fence", () => {
    const dir = tmpDir();
    const f = writePlanFile(dir, "plan.md", PHASE_WITH_FENCE);
    const r = validatePlan(f);
    expect(r.errors).toEqual([]);
  });

  it("emits warnings for missing fields on a single-file plan", () => {
    const dir = tmpDir();
    const f = writePlanFile(dir, "plan.md", PHASE_MISSING_FIELDS);
    const r = validatePlan(f);
    expect(r.warnings.some((w) => w.code === "missing-files")).toBe(true);
  });

  it("returns no errors for a single file with no fence (legacy plans)", () => {
    const dir = tmpDir();
    const f = writePlanFile(dir, "plan.md", "# Plan\n\nSome prose.\n");
    const r = validatePlan(f);
    // No items → no warnings, no errors
    expect(r.errors).toEqual([]);
  });
});

describe("validatePlan — never throws", () => {
  it("degrades to a report on filesystem-stat failure", () => {
    // Path that doesn't exist — should yield a missing-plan error,
    // not throw.
    expect(() => validatePlan("/totally/missing/path")).not.toThrow();
  });
});
