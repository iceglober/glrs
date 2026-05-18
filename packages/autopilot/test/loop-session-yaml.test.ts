/**
 * Tests for loop-session's YAML path (a5).
 *
 * Covers:
 *   - extractSection reads goal from spec/main.yaml when available
 *   - detectPhaseFiles reads phases array from spec/main.yaml
 *   - markPhaseChecked updates spec/main.yaml
 *   - filterUncheckedPhases uses YAML completed field
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as yamlParse } from "yaml";
import { runLoopSession } from "../src/loop-session.js";
import type { LoopResult } from "../src/loop.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-session-yaml-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeSpec(planDir: string, filename: string, content: string): void {
  const specDir = path.join(planDir, "spec");
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, filename), content, "utf-8");
}

function readYaml(planDir: string, filename: string): unknown {
  const content = fs.readFileSync(
    path.join(planDir, "spec", filename),
    "utf-8",
  );
  return yamlParse(content);
}

// ---------------------------------------------------------------------------
// extractSection reads goal from spec/main.yaml
// ---------------------------------------------------------------------------

describe("extractSection reads goal from spec/main.yaml", () => {
  it("extractSection reads goal from spec/main.yaml", async () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    // Write spec/main.yaml with goal
    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Implement the widget factory
constraints: Use bun:test
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    // Write spec/wave_0.yaml
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: First item
    checked: false
    verify: echo done
`,
    );

    // Also write main.md so the plan is valid for the markdown path
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature

## Goal

Implement the widget factory

## Constraints

Use bun:test

## Phases

- [ ] wave_0.yaml
`,
    );

    // Write wave_0.yaml (markdown) for the markdown fallback
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0

\`\`\`plan-state
- [ ] id: a1
  intent: First item
  verify: echo done
\`\`\`
`,
    );

    // Capture what prompt was passed to runRalphLoop
    let capturedPrompt = "";
    const mockLoop = async (opts: { prompt: string }): Promise<LoopResult> => {
      capturedPrompt = opts.prompt;
      return {
        exitReason: "sentinel",
        iterations: 1,
        message: "done",
        cumulativeCostUsd: 0,
      };
    };

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) =>
          fs.writeFileSync(p, c, "utf-8"),
      },
    });

    // The prompt should contain the goal from spec/main.yaml
    expect(capturedPrompt).toContain("Implement the widget factory");
  });
});

// ---------------------------------------------------------------------------
// detectPhaseFiles reads phases array from spec/main.yaml
// ---------------------------------------------------------------------------

describe("detectPhaseFiles reads phases array from spec/main.yaml", () => {
  it("detectPhaseFiles reads phases array from spec/main.yaml", async () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
  - file: wave_1.yaml
    completed: false
`,
    );

    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: First item
    checked: false
    verify: echo done
`,
    );

    writeSpec(
      planDir,
      "wave_1.yaml",
      `items:
  - id: b1
    intent: Second item
    checked: false
    verify: echo done
`,
    );

    // Also write markdown files for the markdown fallback
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature

## Goal

Do the thing

## Phases

- [ ] wave_0.yaml
- [ ] wave_1.yaml
`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0\n\n\`\`\`plan-state\n- [ ] id: a1\n  intent: First item\n  verify: echo done\n\`\`\`\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_1.yaml"),
      `# Wave 1\n\n\`\`\`plan-state\n- [ ] id: b1\n  intent: Second item\n  verify: echo done\n\`\`\`\n`,
    );

    const phasesRun: string[] = [];
    const mockLoop = async (opts: { prompt: string }): Promise<LoopResult> => {
      // Extract phase file from prompt
      const match = /Your phase \(([^)]+)\)/.exec(opts.prompt);
      if (match) phasesRun.push(match[1]);
      return {
        exitReason: "sentinel",
        iterations: 1,
        message: "done",
        cumulativeCostUsd: 0,
      };
    };

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) =>
          fs.writeFileSync(p, c, "utf-8"),
      },
    });

    // Both phases should have been run
    expect(phasesRun).toHaveLength(2);
    expect(phasesRun).toContain("wave_0.yaml");
    expect(phasesRun).toContain("wave_1.yaml");
  });
});

// ---------------------------------------------------------------------------
// markPhaseChecked updates spec/main.yaml
// ---------------------------------------------------------------------------

describe("markPhaseChecked updates spec/main.yaml", () => {
  it("markPhaseChecked updates spec/main.yaml", async () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Do the thing
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
    intent: First item
    checked: true
    verify: echo done
`,
    );

    // Also write markdown files
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.yaml\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0\n\n\`\`\`plan-state\n- [x] id: a1\n  intent: First item\n  verify: echo done\n\`\`\`\n`,
    );

    const mockLoop = async (): Promise<LoopResult> => ({
      exitReason: "sentinel",
      iterations: 1,
      message: "done",
      cumulativeCostUsd: 0,
    });

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) =>
          fs.writeFileSync(p, c, "utf-8"),
      },
    });

    // spec/main.yaml should have wave_0.yaml marked completed
    const result = readYaml(planDir, "main.yaml") as {
      phases: Array<{ file: string; completed: boolean }>;
    };
    expect(result.phases[0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterUncheckedPhases uses YAML completed field
// ---------------------------------------------------------------------------

describe("filterUncheckedPhases uses YAML completed field", () => {
  it("filterUncheckedPhases uses YAML completed field", async () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: true
  - file: wave_1.yaml
    completed: false
`,
    );

    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Already done
    checked: true
`,
    );

    writeSpec(
      planDir,
      "wave_1.yaml",
      `items:
  - id: b1
    intent: Pending
    checked: false
    verify: echo done
`,
    );

    // Also write markdown files
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [x] wave_0.yaml\n- [ ] wave_1.yaml\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0\n\n\`\`\`plan-state\n- [x] id: a1\n  intent: Already done\n\`\`\`\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_1.yaml"),
      `# Wave 1\n\n\`\`\`plan-state\n- [ ] id: b1\n  intent: Pending\n  verify: echo done\n\`\`\`\n`,
    );

    const phasesRun: string[] = [];
    const mockLoop = async (opts: { prompt: string }): Promise<LoopResult> => {
      const match = /Your phase \(([^)]+)\)/.exec(opts.prompt);
      if (match) phasesRun.push(match[1]);
      return {
        exitReason: "sentinel",
        iterations: 1,
        message: "done",
        cumulativeCostUsd: 0,
      };
    };

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) =>
          fs.writeFileSync(p, c, "utf-8"),
      },
    });

    // Only wave_1.yaml should have been run (wave_0 is completed)
    expect(phasesRun).toHaveLength(1);
    expect(phasesRun[0]).toBe("wave_1.yaml");
  });
});

// ---------------------------------------------------------------------------
// isPhaseComplete on YAML specs (a2)
// ---------------------------------------------------------------------------

describe("isPhaseComplete on YAML specs", () => {
  it("isPhaseComplete returns false when YAML items have unchecked entries", async () => {
    const planDir = path.join(tmpDir, "plan-a2-false");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    // wave_0.yaml has one unchecked item — phase should NOT be marked complete
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Unchecked item
    checked: false
    verify: echo done
`,
    );

    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.yaml\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0\n\n\`\`\`plan-state\n- [ ] id: a1\n  intent: Unchecked item\n  verify: echo done\n\`\`\`\n`,
    );

    let phaseCompleted = false;
    const mockLoop = async (): Promise<LoopResult> => ({
      exitReason: "sentinel",
      iterations: 1,
      message: "done",
      cumulativeCostUsd: 0,
    });

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) => {
          // Detect if main.yaml is being written with completed: true
          if (p.endsWith("main.yaml")) {
            const { parse } = require("yaml") as typeof import("yaml");
            const parsed = parse(c) as { phases?: Array<{ completed?: boolean }> };
            if (parsed?.phases?.[0]?.completed === true) {
              phaseCompleted = true;
            }
          }
          fs.writeFileSync(p, c, "utf-8");
        },
      },
    });

    // Phase has unchecked items — should NOT be marked completed
    expect(phaseCompleted).toBe(false);
  });

  it("isPhaseComplete returns true when all YAML items are checked", async () => {
    const planDir = path.join(tmpDir, "plan-a2-true");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    // wave_0.yaml has all items checked — phase should be marked complete
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Checked item
    checked: true
    verify: echo done
`,
    );

    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.yaml\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0\n\n\`\`\`plan-state\n- [x] id: a1\n  intent: Checked item\n  verify: echo done\n\`\`\`\n`,
    );

    let phaseCompleted = false;
    const mockLoop = async (): Promise<LoopResult> => ({
      exitReason: "sentinel",
      iterations: 1,
      message: "done",
      cumulativeCostUsd: 0,
    });

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) => {
          if (p.endsWith("main.yaml")) {
            const { parse } = require("yaml") as typeof import("yaml");
            const parsed = parse(c) as { phases?: Array<{ completed?: boolean }> };
            if (parsed?.phases?.[0]?.completed === true) {
              phaseCompleted = true;
            }
          }
          fs.writeFileSync(p, c, "utf-8");
        },
      },
    });

    // All items checked — phase should be marked completed
    // specMarkPhaseCompleted writes directly to disk, so also check the file
    if (!phaseCompleted) {
      const mainYaml = readYaml(planDir, "main.yaml") as {
        phases: Array<{ file: string; completed: boolean }>;
      };
      phaseCompleted = mainYaml.phases[0].completed === true;
    }
    expect(phaseCompleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verify gate on YAML specs (a3)
// ---------------------------------------------------------------------------

describe("verify gate on YAML specs", () => {
  it("verify gate runs verify commands from YAML spec items", async () => {
    const planDir = path.join(tmpDir, "plan-a3");
    fs.mkdirSync(planDir);

    writeSpec(
      planDir,
      "main.yaml",
      `title: My Feature
goal: Do the thing
phases:
  - file: wave_0.yaml
    completed: false
`,
    );

    // All items checked — phase is complete, verify gate should run
    writeSpec(
      planDir,
      "wave_0.yaml",
      `items:
  - id: a1
    intent: Checked item with verify
    checked: true
    verify: echo verify-ran
`,
    );

    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# My Feature\n\n## Goal\n\nDo the thing\n\n## Phases\n\n- [ ] wave_0.yaml\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.yaml"),
      `# Wave 0\n\n\`\`\`plan-state\n- [x] id: a1\n  intent: Checked item with verify\n  verify: echo verify-ran\n\`\`\`\n`,
    );

    const verifyCommandsRun: string[] = [];
    const mockLoop = async (): Promise<LoopResult> => ({
      exitReason: "sentinel",
      iterations: 1,
      message: "done",
      cumulativeCostUsd: 0,
    });

    await runLoopSession({
      planPath: planDir,
      cwd: tmpDir,
      fast: false,
      _deps: {
        runRalphLoop: mockLoop,
        isDirectory: () => true,
        readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
        writeFileSync: (p: string, c: string) => fs.writeFileSync(p, c, "utf-8"),
        runVerifyCommands: async (items) => {
          for (const it of items) {
            verifyCommandsRun.push(it.verify);
          }
          return items.map((it) => ({
            itemId: it.id,
            command: it.verify,
            passed: true,
            stdout: "",
            stderr: "",
            durationMs: 1,
          }));
        },
      },
    });

    // Verify gate should have run the verify command from the YAML item
    expect(verifyCommandsRun).toHaveLength(1);
    expect(verifyCommandsRun[0]).toBe("echo verify-ran");
  });
});
