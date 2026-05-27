/**
 * Tests for the per-item execution path (item 4.8).
 * Verifies that each item gets its own runRalphLoop call with a
 * scoped prompt.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runLoopSession } from "../src/loop-session.js";

describe("per-item execution (item 4.8)", () => {
  let mdTmpDir: string;

  beforeEach(() => {
    mdTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "per-item-md-test-"));
  });

  afterEach(() => {
    fs.rmSync(mdTmpDir, { recursive: true, force: true });
  });

  it("dispatches one runRalphLoop call per item", async () => {
    // Create a real plan directory with YAML spec files
    const planDir = path.join(mdTmpDir, "plan");
    const specDir = path.join(planDir, "spec");
    fs.mkdirSync(specDir, { recursive: true });

    fs.writeFileSync(
      path.join(specDir, "main.yaml"),
      `title: My Feature
goal: Implement features.
constraints: Use bun:test
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    const phaseYaml = `items:
  - id: "1.1"
    intent: do the first thing
    checked: false
    files:
      - path: src/a.ts
        isNew: false
        change: edit it
    tests:
      - tests/a.test.ts
    verify: bun test tests/a.test.ts
  - id: "1.2"
    intent: do the second thing
    checked: false
    files:
      - path: src/b.ts
        isNew: false
        change: edit it
    tests:
      - tests/b.test.ts
    verify: bun test tests/b.test.ts
`;
    fs.writeFileSync(path.join(specDir, "wave_0.yaml"), phaseYaml);

    const dispatchedPrompts: string[] = [];

    await runLoopSession({
      planPath: planDir,
      cwd: mdTmpDir,
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, content: string) => fs.writeFileSync(p, content, "utf-8"),
        runRalphLoop: async (opts) => {
          dispatchedPrompts.push(opts.prompt);
          // After each per-item call, mark the item checked by rewriting the YAML
          if (dispatchedPrompts.length === 1) {
            // Mark 1.1 checked
            const updated = fs.readFileSync(path.join(specDir, "wave_0.yaml"), "utf-8")
              .replace(
                /- id: "1.1"\n    intent: do the first thing\n    checked: false/,
                '- id: "1.1"\n    intent: do the first thing\n    checked: true',
              );
            fs.writeFileSync(path.join(specDir, "wave_0.yaml"), updated);
          } else if (dispatchedPrompts.length === 2) {
            // Mark 1.2 checked
            const updated = fs.readFileSync(path.join(specDir, "wave_0.yaml"), "utf-8")
              .replace(
                /- id: "1.2"\n    intent: do the second thing\n    checked: false/,
                '- id: "1.2"\n    intent: do the second thing\n    checked: true',
              );
            fs.writeFileSync(path.join(specDir, "wave_0.yaml"), updated);
          }
          return {
            exitReason: "sentinel",
            iterations: 1,
            message: "item done",
          };
        },
        runVerifyCommands: async (items) =>
          items.map((it) => ({
            itemId: it.id,
            command: it.verify,
            passed: true,
            stdout: "",
            stderr: "",
            durationMs: 1,
          })),
      },
    });

    // Two items → two dispatches.
    expect(dispatchedPrompts).toHaveLength(2);

    // First prompt scopes to item 1.1.
    expect(dispatchedPrompts[0]).toContain("ONE item");
    expect(dispatchedPrompts[0]).toContain("id: 1.1");
    expect(dispatchedPrompts[0]).toContain("src/a.ts");
    expect(dispatchedPrompts[0]).not.toContain("id: 1.2");

    // Second prompt scopes to item 1.2.
    expect(dispatchedPrompts[1]).toContain("id: 1.2");
    expect(dispatchedPrompts[1]).toContain("src/b.ts");
  });

});

// ---------------------------------------------------------------------------
// YAML spec path tests (a1)
// ---------------------------------------------------------------------------

let yamlTmpDir: string;

beforeEach(() => {
  yamlTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "per-item-yaml-test-"));
});

afterEach(() => {
  fs.rmSync(yamlTmpDir, { recursive: true, force: true });
});

function writeYamlSpec(planDir: string, filename: string, content: string): void {
  const specDir = path.join(planDir, "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, filename), content, "utf-8");
}

describe("YAML spec: per-item execution", () => {
  it("YAML spec: filters out checked items and runs only unchecked", async () => {
    // Plan structure: spec/main.yaml + spec/wave_0.yaml
    // wave_0.yaml has y1 (unchecked) and y2 (checked) — only y1 should run
    const planDir = path.join(yamlTmpDir, "plan");
    fs.mkdirSync(planDir);

    writeYamlSpec(planDir, "main.yaml", `title: My Feature
goal: Implement features.
constraints: Use bun:test
phases:
  - file: wave_0.yaml
    completed: false
`);

    const phaseYaml = `items:
  - id: y1
    intent: do the first yaml thing
    checked: false
    files:
      - path: src/a.ts
        isNew: false
        change: edit it
    tests:
      - tests/a.test.ts
    verify: bun test tests/a.test.ts
  - id: y2
    intent: do the second yaml thing
    checked: true
    files:
      - path: src/b.ts
        isNew: false
        change: edit it
    tests:
      - tests/b.test.ts
    verify: bun test tests/b.test.ts
`;
    writeYamlSpec(planDir, "wave_0.yaml", phaseYaml);

    const dispatchedPrompts: string[] = [];

    await runLoopSession({
      planPath: planDir,
      cwd: yamlTmpDir,
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, content: string) => fs.writeFileSync(p, content, "utf-8"),
        runRalphLoop: async (opts) => {
          dispatchedPrompts.push(opts.prompt);
          // Mark y1 checked after the run so isPhaseComplete passes
          const updated = phaseYaml.replace(
            /- id: y1\n    intent: do the first yaml thing\n    checked: false/,
            "- id: y1\n    intent: do the first yaml thing\n    checked: true",
          );
          fs.writeFileSync(path.join(planDir, "spec", "wave_0.yaml"), updated, "utf-8");
          return {
            exitReason: "sentinel",
            iterations: 1,
            message: "item done",
          };
        },
        runVerifyCommands: async (items) =>
          items.map((it) => ({
            itemId: it.id,
            command: it.verify,
            passed: true,
            stdout: "",
            stderr: "",
            durationMs: 1,
          })),
      },
    });

    // Only y1 is unchecked — exactly one dispatch
    expect(dispatchedPrompts).toHaveLength(1);
    expect(dispatchedPrompts[0]).toContain("id: y1");
    expect(dispatchedPrompts[0]).not.toContain("id: y2");
  });

  it("YAML spec: falls through to full-phase prompt when no items parsed", async () => {
    const planDir = path.join(yamlTmpDir, "plan2");
    fs.mkdirSync(planDir);

    writeYamlSpec(planDir, "main.yaml", `title: My Feature
goal: Implement features.
constraints: Use bun:test
phases:
  - file: wave_0.yaml
    completed: false
`);
    writeYamlSpec(planDir, "wave_0.yaml", `items: []\n`);

    const dispatchedPrompts: string[] = [];

    await runLoopSession({
      planPath: planDir,
      cwd: yamlTmpDir,
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, content: string) => fs.writeFileSync(p, content, "utf-8"),
        runRalphLoop: async (opts) => {
          dispatchedPrompts.push(opts.prompt);
          return {
            exitReason: "sentinel",
            iterations: 1,
            message: "phase done",
          };
        },
        runVerifyCommands: async () => [],
      },
    });

    // No items → falls through to full-phase prompt
    expect(dispatchedPrompts).toHaveLength(1);
    expect(dispatchedPrompts[0]).toContain("Work through every unchecked item");
  });
});
