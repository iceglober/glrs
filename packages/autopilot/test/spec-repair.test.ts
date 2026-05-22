import { describe, it, expect } from "bun:test";
import { validateAndRepairYaml } from "../src/spec-repair.js";

describe("validateAndRepairYaml", () => {
  it("passes valid phase YAML unchanged", () => {
    const yaml = `items:
  - id: "1.1"
    intent: "Add RBAC to users"
    checked: false
`;
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(true);
    expect(result.corrections).toEqual([]);
    expect(result.content).toBe(yaml);
  });

  it("passes valid main YAML unchanged", () => {
    const yaml = `title: My Plan
phases:
  - file: wave_0.yaml
    completed: false
`;
    const result = validateAndRepairYaml(yaml, true);
    expect(result.valid).toBe(true);
    expect(result.corrections).toEqual([]);
  });

  it("fixes unquoted value containing colon", () => {
    const yaml = `items:
  - id: "1.1"
    intent: "Add scope field"
    checked: false
    files:
      - path: src/index.ts
        isNew: false
        change: Add \`scope: 'shared'\` to the module export. No other changes.
`;
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(true);
    expect(result.corrections.length).toBeGreaterThan(0);
    expect(result.corrections[0]).toContain("quoted value containing colon");
    expect(result.content).toContain('"Add `scope:');
  });

  it("fixes tab indentation", () => {
    const yaml = "items:\n\t- id: \"1.1\"\n\t  intent: \"Fix tabs\"\n\t  checked: false\n";
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(true);
    expect(result.corrections.some((c) => c.includes("tabs to spaces"))).toBe(true);
    expect(result.content).not.toContain("\t");
  });

  it("fixes multiple colons in one value", () => {
    const yaml = `items:
  - id: "2.1"
    intent: "Implement endpoint"
    checked: false
    mirror: "Check header: version and content-type: json"
`;
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(true);
  });

  it("does not double-quote already quoted values", () => {
    const yaml = `items:
  - id: "1.1"
    intent: "Add scope: shared to exports"
    checked: false
`;
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(true);
    expect(result.corrections).toEqual([]);
  });

  it("returns invalid for unfixable YAML", () => {
    const yaml = "this is not yaml at all: [[[";
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(false);
    expect(result.parseError).toBeDefined();
  });

  it("returns schema errors for valid YAML missing required fields", () => {
    const yaml = "items:\n  - intent: missing id field\n";
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors).toBeDefined();
    expect(result.schemaErrors!.some((e) => e.includes("id"))).toBe(true);
  });

  it("preserves block scalars when quoting", () => {
    const yaml = `items:
  - id: "1.1"
    intent: "Test block scalar"
    checked: false
    context: |
      This has a colon: in the block
      And another line: with one
`;
    const result = validateAndRepairYaml(yaml, false);
    expect(result.valid).toBe(true);
    expect(result.corrections).toEqual([]);
  });
});
