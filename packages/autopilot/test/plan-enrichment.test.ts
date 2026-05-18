/**
 * Tests for the plan-enrichment idempotency helper (item 4.3) and
 * smoke-tests the per-file enrichment refactor (item 4.4).
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  computeEnrichmentRatio,
  computeSpecEnrichmentRatio,
  ENRICHMENT_RATIO_THRESHOLD,
} from "../src/plan-enrichment.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-enrichment-test-"));
}

function writeFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe("computeEnrichmentRatio", () => {
  it("returns 0 when no items present", () => {
    const dir = tmpDir();
    const f = writeFile(dir, "phase.md", "# Title\n\nNo items here.\n");
    expect(computeEnrichmentRatio([f])).toBe(0);
  });

  it("returns 0 when items have no enrichment fields", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **First item**
- [ ] 1.2 **Second item**
`,
    );
    expect(computeEnrichmentRatio([f])).toBe(0);
  });

  it("returns 1 when every item has all three fields", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **First item**
  - mirror: src/foo.ts
  - context: existing code
  - conventions: bun:test

- [ ] 1.2 **Second item**
  - mirror: src/bar.ts
  - context: another snippet
  - conventions: bun:test
`,
    );
    expect(computeEnrichmentRatio([f])).toBe(1);
  });

  it("computes a fractional ratio for partially-enriched plans", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **First item**
  - mirror: src/foo.ts
  - context: existing code
  - conventions: bun:test

- [ ] 1.2 **Second item**
- [ ] 1.3 **Third item**
- [ ] 1.4 **Fourth item**
`,
    );
    // 1 enriched / 4 items = 0.25
    expect(computeEnrichmentRatio([f])).toBeCloseTo(0.25, 2);
  });

  it("handles checked items the same as unchecked", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [x] 1.1 **First item**
  - mirror: src/foo.ts
  - context: x
  - conventions: y
`,
    );
    expect(computeEnrichmentRatio([f])).toBe(1);
  });

  it("aggregates counts across multiple files", () => {
    const dir = tmpDir();
    const f1 = writeFile(
      dir,
      "phase_1.md",
      `- [ ] 1.1 **a**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.2 **b**
`,
    );
    const f2 = writeFile(
      dir,
      "phase_2.md",
      `- [ ] 2.1 **c**
- [ ] 2.2 **d**
`,
    );
    // Across both: 4 items, 1 enriched → 0.25
    expect(computeEnrichmentRatio([f1, f2])).toBeCloseTo(0.25, 2);
  });

  it("treats unreadable files as 0 items (no NaN, no throw)", () => {
    const ratio = computeEnrichmentRatio(["/nonexistent/path/file.md"]);
    expect(ratio).toBe(0);
  });

  it("the threshold constant is 1.0 (100% — every item must be enriched)", () => {
    expect(ENRICHMENT_RATIO_THRESHOLD).toBe(1.0);
  });

  it("a plan with 4/5 items enriched is at the threshold", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **a**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.2 **b**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.3 **c**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.4 **d**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.5 **e**
`,
    );
    // 4 enriched / 5 items = 0.8 — at the threshold (not above)
    expect(computeEnrichmentRatio([f])).toBe(0.8);
  });

  it("a plan with 5/5 items enriched meets the threshold", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **a**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.2 **b**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.3 **c**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.4 **d**
  - mirror: x
  - context: y
  - conventions: z
- [ ] 1.5 **e**
  - mirror: x
  - context: y
  - conventions: z
`,
    );
    expect(computeEnrichmentRatio([f])).toBeGreaterThanOrEqual(
      ENRICHMENT_RATIO_THRESHOLD,
    );
  });

  it("supports custom field names", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **First item**
  - template: src/foo.ts
  - examples: existing code
  - requirements: custom requirement

- [ ] 1.2 **Second item**
  - template: src/bar.ts
  - examples: another snippet
  - requirements: another requirement
`,
    );
    const customFields = ["template", "examples", "requirements"];
    expect(computeEnrichmentRatio([f], customFields)).toBe(1);
  });

  it("custom field names return 0 when not present", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **First item**
  - mirror: src/foo.ts
  - context: existing code
  - conventions: bun:test
`,
    );
    const customFields = ["template", "examples", "requirements"];
    expect(computeEnrichmentRatio([f], customFields)).toBe(0);
  });

  it("falls back to default fields when none provided", () => {
    const dir = tmpDir();
    const f = writeFile(
      dir,
      "phase.md",
      `# Title

- [ ] 1.1 **a**
  - mirror: x
  - context: y
  - conventions: z
`,
    );
    // No field names provided, should use defaults
    expect(computeEnrichmentRatio([f])).toBe(1);
  });
});
