/**
 * Tests for the loop session runner.
 *
 * DI-based tests verifying:
 *   - Multi-file plan prompt shaping (directory path)
 *   - Single-file plan prompt shaping (.md file path)
 *   - LoopResult is returned unchanged
 */

import { describe, it, expect } from "bun:test";
import { runLoopSession } from "../src/autopilot/loop-session.js";

describe("runLoopSession", () => {
  it("shapes prompt for multi-file plan (directory)", async () => {
    let capturedPrompt = "";
    let capturedCwd = "";

    const result = await runLoopSession({
      planPath: "/tmp/plans/feat",
      cwd: "/tmp/repo",
      _deps: {
        isDirectory: (_p) => true,
        runRalphLoop: async (opts) => {
          capturedPrompt = opts.prompt;
          capturedCwd = opts.cwd;
          return { exitReason: "sentinel", iterations: 2, message: "Done" };
        },
      },
    });

    expect(capturedPrompt).toContain("/tmp/plans/feat/main.md");
    expect(capturedPrompt).toContain("## Phases");
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
        runRalphLoop: async (opts) => {
          capturedPrompt = opts.prompt;
          return { exitReason: "sentinel", iterations: 3, message: "Done" };
        },
      },
    });

    // Should reference main.md, not just the directory
    expect(capturedPrompt).toContain("/tmp/plans/my-feature/main.md");
  });
});
