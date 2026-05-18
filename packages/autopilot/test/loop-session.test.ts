/**
 * Tests for the loop session runner.
 *
 * DI-based tests verifying:
 *   - Multi-file plan prompt shaping (directory path)
 *   - Single-file plan prompt shaping (.md file path)
 *   - LoopResult is returned unchanged
 *   - Per-phase session execution (a3, a4)
 */

import { describe, it, expect } from "bun:test";
import { runLoopSession } from "../src/loop-session.js";

describe("runLoopSession", () => {
  it("shapes prompt for multi-file plan (directory)", async () => {
    let capturedPrompt = "";
    let capturedCwd = "";

    const result = await runLoopSession({
      planPath: "/tmp/plans/feat",
      cwd: "/tmp/repo",
      _deps: {
        isDirectory: (_p) => true,
        readFileSync: (_p: string) =>
          "## Goal\nBuild it.\n\n## Constraints\n- Simple.\n\n## Phases\n\n- [ ] phase_1.md — Phase 1\n",
        writeFileSync: () => {},
        runRalphLoop: async (opts) => {
          capturedPrompt = opts.prompt;
          capturedCwd = opts.cwd;
          return { exitReason: "sentinel", iterations: 2, message: "Done" };
        },
      },
    });

    expect(capturedPrompt).toContain("Build it.");
    expect(capturedPrompt).toContain("Phase 1");
    expect(capturedCwd).toBe("/tmp/repo");
    expect(result.exitReason).toBe("sentinel");
    expect(result.iterations).toBe(2);
  });

  it("shapes prompt for single-file plan (.md file)", async () => {
    let capturedPrompt = "";

    await runLoopSession({
      planPath: "/tmp/plans/feat.md",
      cwd: "/tmp/repo",
      _deps: {
        isDirectory: (_p) => false,
        runRalphLoop: async (opts) => {
          capturedPrompt = opts.prompt;
          return { exitReason: "sentinel", iterations: 1, message: "Done" };
        },
      },
    });

    expect(capturedPrompt).toContain("/tmp/plans/feat.md");
    expect(capturedPrompt).toContain("## Acceptance criteria");
    expect(capturedPrompt).not.toContain("main.md");
  });

  it("returns LoopResult unchanged from runRalphLoop", async () => {
    const result = await runLoopSession({
      planPath: "/tmp/plans/feat.md",
      cwd: "/tmp/repo",
      _deps: {
        isDirectory: (_p) => false,
        runRalphLoop: async (_opts) => ({
          exitReason: "max-iterations",
          iterations: 50,
          message: "Reached maximum iterations (50). Stopping.",
        }),
      },
    });

    expect(result.exitReason).toBe("max-iterations");
    expect(result.iterations).toBe(50);
    expect(result.message).toContain("50");
  });

  it("propagates errors from runRalphLoop", async () => {
    await expect(
      runLoopSession({
        planPath: "/tmp/plans/feat.md",
        cwd: "/tmp/repo",
        _deps: {
          isDirectory: (_p) => false,
          runRalphLoop: async (_opts) => {
            throw new Error("loop crashed");
          },
        },
      }),
    ).rejects.toThrow("loop crashed");
  });

  it("multi-file prompt references main.md not the directory itself", async () => {
    let capturedPrompt = "";

    await runLoopSession({
      planPath: "/tmp/plans/my-feature",
      cwd: "/tmp/repo",
      _deps: {
        isDirectory: (_p) => true,
        readFileSync: (_p: string) =>
          "## Goal\nBuild it.\n\n## Constraints\n- Simple.\n\n## Phases\n\n- [ ] phase_1.md — Phase 1\n",
        writeFileSync: () => {},
        runRalphLoop: async (opts) => {
          capturedPrompt = opts.prompt;
          return { exitReason: "sentinel", iterations: 3, message: "Done" };
        },
      },
    });

    // Per-phase prompt includes goal and phase content, not a raw main.md reference
    expect(capturedPrompt).toContain("Build it.");
    expect(capturedPrompt).toContain("Phase 1");
  });
});

// ---------------------------------------------------------------------------
// Per-phase session execution (a3, a4)
// ---------------------------------------------------------------------------

const MAIN_MD_WITH_TWO_PHASES = `# My Feature

## Goal
Build the widget system.

## Constraints
- Keep it simple.

## Phases

- [ ] phase_1.md — Phase 1: Core
- [ ] phase_2.md — Phase 2: Tests
`;

const MAIN_MD_FIRST_PHASE_CHECKED = `# My Feature

## Goal
Build the widget system.

## Constraints
- Keep it simple.

## Phases

- [x] phase_1.md — Phase 1: Core
- [ ] phase_2.md — Phase 2: Tests
`;

const MAIN_MD_BOTH_PHASES_CHECKED = `# My Feature

## Goal
Build the widget system.

## Constraints
- Keep it simple.

## Phases

- [x] phase_1.md — Phase 1: Core
- [x] phase_2.md — Phase 2: Tests
`;

const PHASE_1_CONTENT = `# Phase 1: Core

## Acceptance criteria

\`\`\`plan-state
- [ ] id: a1
  intent: Create the widget
  tests:
    - test/widget.test.ts::"creates widget"
  verify: bun test test/widget.test.ts
\`\`\`
`;

const PHASE_1_CONTENT_DONE = `# Phase 1: Core

## Acceptance criteria

\`\`\`plan-state
- [x] id: a1
  intent: Create the widget
  tests:
    - test/widget.test.ts::"creates widget"
  verify: bun test test/widget.test.ts
\`\`\`
`;

const PHASE_2_CONTENT = `# Phase 2: Tests

## Acceptance criteria

\`\`\`plan-state
- [ ] id: b1
  intent: Write integration tests
  tests:
    - test/integration.test.ts::"passes"
  verify: bun test test/integration.test.ts
\`\`\`
`;

const PHASE_2_CONTENT_DONE = `# Phase 2: Tests

## Acceptance criteria

\`\`\`plan-state
- [x] id: b1
  intent: Write integration tests
  tests:
    - test/integration.test.ts::"passes"
  verify: bun test test/integration.test.ts
\`\`\`
`;

describe("per-phase session execution", () => {
  it("per-phase session creates one runRalphLoop call per unchecked phase", async () => {
    const loopCalls: string[] = [];

    // File system state: main.md has two unchecked phases
    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_WITH_TWO_PHASES,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          loopCalls.push(opts.prompt);
          // Simulate phase completion: mark items done in the phase file
          if (opts.prompt.includes("Phase 1")) {
            fileState["/plans/feat/phase_1.md"] = PHASE_1_CONTENT_DONE;
          } else if (opts.prompt.includes("Phase 2")) {
            fileState["/plans/feat/phase_2.md"] = PHASE_2_CONTENT_DONE;
          }
          return { exitReason: "sentinel", iterations: 2, message: "Done" };
        },
      },
    });

    expect(loopCalls).toHaveLength(2);
  });

  it("per-phase prompt includes Goal and Constraints from main.md", async () => {
    const capturedPrompts: string[] = [];

    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_WITH_TWO_PHASES,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          capturedPrompts.push(opts.prompt);
          if (opts.prompt.includes("Phase 1")) {
            fileState["/plans/feat/phase_1.md"] = PHASE_1_CONTENT_DONE;
          } else {
            fileState["/plans/feat/phase_2.md"] = PHASE_2_CONTENT_DONE;
          }
          return { exitReason: "sentinel", iterations: 1, message: "Done" };
        },
      },
    });

    // Both prompts should include the Goal and Constraints from main.md
    for (const prompt of capturedPrompts) {
      expect(prompt).toContain("Build the widget system.");
      expect(prompt).toContain("Keep it simple.");
    }
  });

  it("per-phase prompt includes full phase file contents", async () => {
    const capturedPrompts: string[] = [];

    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_WITH_TWO_PHASES,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          capturedPrompts.push(opts.prompt);
          if (opts.prompt.includes("Phase 1")) {
            fileState["/plans/feat/phase_1.md"] = PHASE_1_CONTENT_DONE;
          } else {
            fileState["/plans/feat/phase_2.md"] = PHASE_2_CONTENT_DONE;
          }
          return { exitReason: "sentinel", iterations: 1, message: "Done" };
        },
      },
    });

    expect(capturedPrompts[0]).toContain("Phase 1: Core");
    expect(capturedPrompts[1]).toContain("Phase 2: Tests");
  });

  it("phases already checked are skipped", async () => {
    const loopCalls: string[] = [];

    // main.md has phase_1 already checked, only phase_2 is unchecked
    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_FIRST_PHASE_CHECKED,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT_DONE,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          loopCalls.push(opts.prompt);
          fileState["/plans/feat/phase_2.md"] = PHASE_2_CONTENT_DONE;
          return { exitReason: "sentinel", iterations: 1, message: "Done" };
        },
      },
    });

    // Only one call — phase_1 was already checked
    expect(loopCalls).toHaveLength(1);
    expect(loopCalls[0]).toContain("Phase 2");
  });

  it("falls back to single-session when plan lacks phase files", async () => {
    let capturedPrompt = "";

    await runLoopSession({
      planPath: "/plans/feat.md",
      cwd: "/repo",
      _deps: {
        isDirectory: () => false,
        readFileSync: (_p: string) => "# Plan\n\n- [ ] item\n",
        writeFileSync: () => {},
        runRalphLoop: async (opts) => {
          capturedPrompt = opts.prompt;
          return { exitReason: "sentinel", iterations: 1, message: "Done" };
        },
      },
    });

    // Single-file path: prompt references the plan file directly
    expect(capturedPrompt).toContain("/plans/feat.md");
    expect(capturedPrompt).toContain("## Acceptance criteria");
  });

  it("marks phase checkbox in main.md after successful phase completion", async () => {
    let writtenMainMd = "";

    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_WITH_TWO_PHASES,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
          if (p === "/plans/feat/main.md") {
            writtenMainMd = content;
          }
        },
        runRalphLoop: async (opts) => {
          if (opts.prompt.includes("Phase 1")) {
            fileState["/plans/feat/phase_1.md"] = PHASE_1_CONTENT_DONE;
          } else {
            fileState["/plans/feat/phase_2.md"] = PHASE_2_CONTENT_DONE;
          }
          return { exitReason: "sentinel", iterations: 1, message: "Done" };
        },
        // Stub the verify runner — fixtures declare `verify: bun test ...`
        // commands, but we don't actually want to spawn shells in unit
        // tests. Returning all-passed exercises the post-phase test gate
        // in its happy-path shape (item 4.1).
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

    // main.md should have both phases checked after completion
    expect(writtenMainMd).toContain("[x] phase_1.md");
    expect(writtenMainMd).toContain("[x] phase_2.md");
  });

  it("stops and returns result when phase exits with struggle", async () => {
    const loopCalls: string[] = [];

    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_WITH_TWO_PHASES,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    const result = await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          loopCalls.push(opts.prompt);
          // Phase 1 fails with struggle — phase_1.md items remain unchecked
          return { exitReason: "struggle", iterations: 5, message: "Struggling" };
        },
      },
    });

    // Should stop after phase 1 fails — only one loop call
    expect(loopCalls).toHaveLength(1);
    expect(result.exitReason).toBe("struggle");
  });

  it("stops and returns result when phase exits with stall", async () => {
    const loopCalls: string[] = [];

    const fileState: Record<string, string> = {
      "/plans/feat/main.md": MAIN_MD_WITH_TWO_PHASES,
      "/plans/feat/phase_1.md": PHASE_1_CONTENT,
      "/plans/feat/phase_2.md": PHASE_2_CONTENT,
    };

    const result = await runLoopSession({
      planPath: "/plans/feat",
      cwd: "/repo",
      _deps: {
        isDirectory: () => true,
        readFileSync: (p: string) => fileState[p] ?? "",
        writeFileSync: (p: string, content: string) => {
          fileState[p] = content;
        },
        runRalphLoop: async (opts) => {
          loopCalls.push(opts.prompt);
          return { exitReason: "stall", iterations: 3, message: "Stalled" };
        },
      },
    });

    expect(loopCalls).toHaveLength(1);
    expect(result.exitReason).toBe("stall");
  });
});
