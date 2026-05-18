/**
 * Tests for the per-item execution path used by the fast executor
 * (item 4.8). Verifies that --fast dispatches one runRalphLoop call
 * per item (in order, with item-scoped prompts) instead of one call
 * per phase.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runLoopSession } from "../src/loop-session.js";

const MAIN_MD = `# Goal

## Goal

Implement features.

## Constraints

- bun:test

## Phases

- [ ] phase_1.md
`;

const PHASE_WITH_TWO_ITEMS = `# Phase 1

## Items

- [ ] 1.1 **First item**
- [ ] 1.2 **Second item**

\`\`\`plan-state
- [ ] id: 1.1
  intent: do the first thing
  files:
    - src/a.ts
      Change: edit it
  tests:
    - tests/a.test.ts
  verify: bun test tests/a.test.ts

- [ ] id: 1.2
  intent: do the second thing
  files:
    - src/b.ts
      Change: edit it
  tests:
    - tests/b.test.ts
  verify: bun test tests/b.test.ts
\`\`\`
`;

const PHASE_WITH_TWO_ITEMS_DONE = PHASE_WITH_TWO_ITEMS.replace(
  /- \[ \] 1\.1/g,
  "- [x] 1.1",
).replace(/- \[ \] 1\.2/g, "- [x] 1.2");

describe("per-item execution (item 4.8)", () => {
  it("fast mode dispatches one runRalphLoop call per item", async () => {
    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD,
      "/plans/feat/phase_1.md": PHASE_WITH_TWO_ITEMS,
    };

    const dispatchedPrompts: string[] = [];

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      fast: true,
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          dispatchedPrompts.push(opts.prompt);
          // After each per-item call, mark BOTH items done so the
          // phase-complete check passes after the second call. The
          // ordering still matches: prompt 1 sees item 1 unchecked,
          // prompt 2 sees item 2 unchecked.
          if (dispatchedPrompts.length === 2) {
            fileState["/plans/feat/phase_1.md"] = PHASE_WITH_TWO_ITEMS_DONE;
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

  it("deep mode (no --fast) keeps the single per-phase prompt", async () => {
    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD,
      "/plans/feat/phase_1.md": PHASE_WITH_TWO_ITEMS,
    };

    const dispatchedPrompts: string[] = [];

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      // fast: false — default
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          dispatchedPrompts.push(opts.prompt);
          fileState["/plans/feat/phase_1.md"] = PHASE_WITH_TWO_ITEMS_DONE;
          return {
            exitReason: "sentinel",
            iterations: 1,
            message: "phase done",
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

    // One phase → one dispatch. Prompt is the per-phase shape.
    expect(dispatchedPrompts).toHaveLength(1);
    expect(dispatchedPrompts[0]).toContain("Your phase");
    expect(dispatchedPrompts[0]).toContain("Work through every unchecked item");
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
      fast: true,
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
      fast: true,
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
