/**
 * Tests for the interactive autopilot orchestrator.
 *
 * Uses dependency injection to mock opencode session spawning.
 * Verifies: correct sequence of sessions, sentinel detection,
 * banner output, error propagation when a phase fails.
 */

import { describe, it, expect } from "bun:test";
import {
  orchestrateAutopilot,
  type AutopilotOrchestrationDeps,
  type AutopilotOrchestrationOptions,
} from "../src/autopilot/interactive.js";

describe("orchestrateAutopilot", () => {
  it("orchestrates scoper → plan → loop sequence", async () => {
    const calls: string[] = [];

    const deps: AutopilotOrchestrationDeps = {
      runScoper: async (_opts) => {
        calls.push("scoper");
        return { scopePath: "/plans/my-feature/scope.md" };
      },
      runPlan: async (_opts) => {
        calls.push("plan");
        return { planPath: "/plans/my-feature/main.md" };
      },
      runLoop: async (_opts) => {
        calls.push("loop");
        return { exitReason: "sentinel", iterations: 3, message: "Done" };
      },
    };

    const opts: AutopilotOrchestrationOptions = {
      slug: "my-feature",
      planDir: "/plans",
    };

    const result = await orchestrateAutopilot(opts, deps);

    expect(calls).toEqual(["scoper", "plan", "loop"]);
    expect(result.scopePath).toBe("/plans/my-feature/scope.md");
    expect(result.planPath).toBe("/plans/my-feature/main.md");
    expect(result.loopResult.exitReason).toBe("sentinel");
  });

  it("detects scoper completion via scope.md file", async () => {
    let capturedScopeOpts: unknown = null;

    const deps: AutopilotOrchestrationDeps = {
      runScoper: async (opts) => {
        capturedScopeOpts = opts;
        return { scopePath: "/plans/feat/scope.md" };
      },
      runPlan: async (_opts) => ({ planPath: "/plans/feat/main.md" }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    };

    await orchestrateAutopilot({ slug: "feat", planDir: "/plans" }, deps);

    expect(capturedScopeOpts).toMatchObject({ slug: "feat", planDir: "/plans" });
  });

  it("prints status banners between phases", async () => {
    const banners: string[] = [];

    const deps: AutopilotOrchestrationDeps = {
      runScoper: async (_opts) => ({ scopePath: "/plans/feat/scope.md" }),
      runPlan: async (_opts) => ({ planPath: "/plans/feat/main.md" }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 2,
        message: "Done",
      }),
      onBanner: (msg: string) => {
        banners.push(msg);
      },
    };

    await orchestrateAutopilot({ slug: "feat", planDir: "/plans" }, deps);

    // Should have banners for scope completion and plan completion
    expect(banners.some((b) => b.includes("scope.md"))).toBe(true);
    expect(banners.some((b) => b.includes("main.md"))).toBe(true);
  });

  it("propagates error when scoper phase fails", async () => {
    const deps: AutopilotOrchestrationDeps = {
      runScoper: async (_opts) => {
        throw new Error("Scoper timed out");
      },
      runPlan: async (_opts) => ({ planPath: "/plans/feat/main.md" }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    };

    await expect(
      orchestrateAutopilot({ slug: "feat", planDir: "/plans" }, deps),
    ).rejects.toThrow("Scoper timed out");
  });

  it("propagates error when plan phase fails", async () => {
    const deps: AutopilotOrchestrationDeps = {
      runScoper: async (_opts) => ({ scopePath: "/plans/feat/scope.md" }),
      runPlan: async (_opts) => {
        throw new Error("Plan agent failed");
      },
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    };

    await expect(
      orchestrateAutopilot({ slug: "feat", planDir: "/plans" }, deps),
    ).rejects.toThrow("Plan agent failed");
  });
});
