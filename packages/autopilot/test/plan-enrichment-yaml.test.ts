/**
 * Tests for plan-enrichment's YAML path (a6).
 *
 * Covers:
 *   - computeEnrichmentRatio reads from YAML spec when available
 *   - enrichment writes mirror/context/conventions to YAML
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as yamlParse } from "yaml";
import {
  computeEnrichmentRatio,
  enrichPlanForFastModel,
} from "../src/plan-enrichment.js";
import {
  computeSpecEnrichmentRatio,
} from "../src/plan-enrichment.js";
import type { AgentAdapter, AgentHandle } from "../src/adapter.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-enrichment-yaml-test-"));
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
// computeEnrichmentRatio reads from YAML spec when available
// ---------------------------------------------------------------------------

describe("computeEnrichmentRatio reads from YAML spec when available", () => {
  it("computeEnrichmentRatio reads from YAML spec when available", () => {
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

    // wave_0.yaml: 2 items, 1 enriched (with all enrichment fields)
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Enriched item
    checked: false
    mirror: src/existing.ts
    context: "function foo() {}"
    conventions: bun:test
    proof: "should validate"
    proof_type: "test"
  - id: a2
    intent: Not enriched
    checked: false
`,
    );

    const ratio = computeSpecEnrichmentRatio(planDir);
    expect(ratio).toBeCloseTo(0.5, 2);
  });

  it("returns 0 when no items in spec", () => {
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

    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Not enriched
    checked: false
`,
    );

    const ratio = computeSpecEnrichmentRatio(planDir);
    expect(ratio).toBe(0);
  });

  it("returns 1 when all items are enriched", () => {
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

    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Enriched
    checked: false
    mirror: src/a.ts
    context: "code"
    conventions: bun:test
    proof: "should handle case 1"
    proof_type: test
  - id: a2
    intent: Also enriched
    checked: false
    mirror: src/b.ts
    context: "more code"
    conventions: bun:test
    proof: "should handle case 2"
    proof_type: test
`,
    );

    const ratio = computeSpecEnrichmentRatio(planDir);
    expect(ratio).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// enrichment writes mirror/context/conventions to YAML
// ---------------------------------------------------------------------------

describe("enrichment writes mirror/context/conventions to YAML", () => {
  it("enrichment writes mirror/context/conventions to YAML", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item to enrich
    checked: false
`,
    );

    // Import and use the spec-writer directly to simulate what enrichment does
    const { writeEnrichmentFields } = require("../src/spec-writer.js") as typeof import("../src/spec-writer.js");

    writeEnrichmentFields(planDir, "wave_0.yaml", "a1", {
      mirror: "src/existing/similar.ts",
      context: "function foo() { return 42; }",
      conventions: "bun:test, named exports",
    });

    const content = fs.readFileSync(
      path.join(planDir, "spec", "wave_0.yaml"),
      "utf-8",
    );
    const result = yamlParse(content) as {
      items: Array<{
        id: string;
        mirror: string;
        context: string;
        conventions: string;
      }>;
    };
    expect(result.items[0].mirror).toBe("src/existing/similar.ts");
    expect(result.items[0].context).toBe("function foo() { return 42; }");
    expect(result.items[0].conventions).toBe("bun:test, named exports");
  });
});

// ---------------------------------------------------------------------------
// Re-enrichment skips phase files with checked items (a5)
// ---------------------------------------------------------------------------

describe("re-enrichment skips checked phases", () => {
  it("skips phase files with checked items during re-enrichment", async () => {
    const planDir = path.join(tmpDir, "plan-a5");
    fs.mkdirSync(planDir);

    // Write main.md so enrichPlanForFastModel can find plan files
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Plan\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.md\n`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.md"),
      `# Wave 0\n\n- [ ] 1.1 **Item one**\n`,
      "utf-8",
    );

    // Write spec/wave_0.yaml with a checked item — enrichment should skip this file
    const specDir = path.join(planDir, "spec");
    fs.mkdirSync(specDir, { recursive: true });
    // Write spec/main.yaml so main.md is also skipped (already has spec)
    fs.writeFileSync(
      path.join(specDir, "main.yaml"),
      `title: My Plan
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(specDir, "wave_0.yaml"),
      `items:
  - id: "1.1"
    intent: Item one
    checked: true
    verify: echo done
`,
      "utf-8",
    );

    // Track which files the adapter was asked to enrich
    const sessionCreatedForFiles: string[] = [];

    const mockAdapter: AgentAdapter = {
      name: "mock",
      start: async () => ({ id: "mock-handle" } as AgentHandle),
      shutdown: async () => {},
      createSession: async (_handle, opts) => {
        sessionCreatedForFiles.push(opts?.agentName ?? "unknown");
        return "mock-session";
      },
      sendAndWait: async () => ({ kind: "idle" as const, title: "" }),
      getLastResponse: async () => "SPEC_COMPLETE",
      getSessionCost: async () => 0,
    };

    await enrichPlanForFastModel(planDir, planDir, undefined, undefined, mockAdapter);

    // wave_0.yaml has a checked item — the adapter should NOT have been asked
    // to create a session for wave_0.md enrichment
    // (main.md may be skipped too if spec/main.yaml already exists)
    // The key assertion: no session was created for wave_0.md
    const wave0Sessions = sessionCreatedForFiles.filter((s) => s === "prime");
    // If wave_0 was skipped, no sessions should have been created for it.
    // We verify by checking the spec file was NOT overwritten (still has checked: true)
    const specContent = fs.readFileSync(path.join(specDir, "wave_0.yaml"), "utf-8");
    const parsed = yamlParse(specContent) as { items: Array<{ checked: boolean }> };
    expect(parsed.items[0].checked).toBe(true);

    // The adapter should not have been called for wave_0.md
    // (0 sessions means the file was skipped before adapter.createSession)
    expect(wave0Sessions).toHaveLength(0);
  });

  it("uses custom field names with computeSpecEnrichmentRatio", () => {
    const planDir = path.join(tmpDir, "plan-custom-fields");
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

    // YAML spec with custom field names
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item with custom fields
    checked: false
    template: src/existing.ts
    examples: function foo() {}
    requirements: "must handle edge case"
  - id: a2
    intent: Not enriched
    checked: false
`,
    );

    // With default fields, ratio should be 0 (no mirror/context/conventions)
    expect(computeSpecEnrichmentRatio(planDir)).toBe(0);

    // With custom fields extracted from strategy
    const customFields = ["template", "examples", "requirements"];
    expect(computeSpecEnrichmentRatio(planDir, customFields)).toBeCloseTo(0.5, 2);
  });

  it("returns 1 when all items have custom enrichment fields", () => {
    const planDir = path.join(tmpDir, "plan-all-custom");
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

    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Item 1
    checked: false
    alpha: value1
    bravo: value2
    charlie: value3
  - id: a2
    intent: Item 2
    checked: false
    alpha: value4
    bravo: value5
    charlie: value6
`,
    );

    // With custom strategy fields
    const customFields = ["alpha", "bravo", "charlie"];
    expect(computeSpecEnrichmentRatio(planDir, customFields)).toBe(1);

    // With default fields
    expect(computeSpecEnrichmentRatio(planDir)).toBe(0);
  });
});
