/**
 * Tests for the interactive autopilot orchestrator.
 *
 * Uses dependency injection to mock opencode session spawning.
 * Verifies: correct sequence of sessions, sentinel detection,
 * banner output, error propagation when a phase fails.
 */

import { describe, it, expect } from "bun:test";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  orchestrateAutopilot,
  runInteractiveAutopilot,
  deriveSlug,
  type AutopilotOrchestrationDeps,
  type AutopilotOrchestrationOptions,
} from "../src/commands/autopilot-interactive.js";

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
      initialGoal: "Build a new feature",
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

    await orchestrateAutopilot({ slug: "feat", planDir: "/plans", initialGoal: "Build a feature" }, deps);

    expect(capturedScopeOpts).toMatchObject({ slug: "feat", planDir: "/plans", initialGoal: "Build a feature" });
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

    await orchestrateAutopilot({ slug: "feat", planDir: "/plans", initialGoal: "Build a feature" }, deps);

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
      orchestrateAutopilot({ slug: "feat", planDir: "/plans", initialGoal: "Build a feature" }, deps),
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
      orchestrateAutopilot({ slug: "feat", planDir: "/plans", initialGoal: "Build a feature" }, deps),
    ).rejects.toThrow("Plan agent failed");
  });
});

// ---------------------------------------------------------------------------
// deriveSlug
// ---------------------------------------------------------------------------

describe("deriveSlug", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(deriveSlug("Add user authentication")).toBe("add-user-authentication");
  });

  it("truncates to 40 characters", () => {
    const long = "a".repeat(50);
    expect(deriveSlug(long).length).toBeLessThanOrEqual(40);
  });

  it("strips leading and trailing hyphens", () => {
    expect(deriveSlug("  hello world  ")).toBe("hello-world");
  });

  it("falls back to feature-<timestamp> for empty input", () => {
    const slug = deriveSlug("   ");
    expect(slug).toMatch(/^feature-\d+$/);
  });

  it("handles special characters", () => {
    expect(deriveSlug("Fix bug #123 in auth/login")).toBe(
      "fix-bug-123-in-auth-login",
    );
  });
});

// ---------------------------------------------------------------------------
// runInteractiveAutopilot — DI-based tests
// ---------------------------------------------------------------------------

describe("runInteractiveAutopilot", () => {
  it("derives slug from goal and calls orchestrateAutopilot", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-test-"));
    const planDir = path.join(tmpDir, "plans");
    fs.mkdirSync(planDir, { recursive: true });

    const calls: string[] = [];

    const result = await runInteractiveAutopilot("/tmp/repo", undefined, {
      promptGoal: async () => "Add user authentication",
      promptTicketRef: async () => "",
      getPlanDir: async (_cwd) => planDir,
      mkdirSync: (p, o) => fs.mkdirSync(p, o),
      writeFileSync: (p, c) => fs.writeFileSync(p, c),
      runScoper: async (_opts) => {
        calls.push("scoper");
        return { scopePath: path.join(planDir, "add-user-authentication", "scope.md") };
      },
      runPlan: async (_opts) => {
        calls.push("plan");
        return { planPath: path.join(planDir, "add-user-authentication.md") };
      },
      runLoop: async (_opts) => {
        calls.push("loop");
        return { exitReason: "sentinel", iterations: 1, message: "Done" };
      },
    });

    expect(calls).toEqual(["scoper", "plan", "loop"]);
    expect(result.loopResult.exitReason).toBe("sentinel");

    // Verify scope-seed.md was written
    const seedPath = path.join(planDir, "add-user-authentication", "scope-seed.md");
    expect(fs.existsSync(seedPath)).toBe(true);
    const seedContent = fs.readFileSync(seedPath, "utf8");
    expect(seedContent).toContain("Add user authentication");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes ticket ref in scope-seed.md when provided", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-test-"));
    const planDir = path.join(tmpDir, "plans");
    fs.mkdirSync(planDir, { recursive: true });

    await runInteractiveAutopilot("/tmp/repo", undefined, {
      promptGoal: async () => "Fix login bug",
      promptTicketRef: async () => "LIN-123",
      getPlanDir: async (_cwd) => planDir,
      mkdirSync: (p, o) => fs.mkdirSync(p, o),
      writeFileSync: (p, c) => fs.writeFileSync(p, c),
      runScoper: async (_opts) => ({
        scopePath: path.join(planDir, "fix-login-bug", "scope.md"),
      }),
      runPlan: async (_opts) => ({
        planPath: path.join(planDir, "fix-login-bug.md"),
      }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    });

    const seedPath = path.join(planDir, "fix-login-bug", "scope-seed.md");
    const seedContent = fs.readFileSync(seedPath, "utf8");
    expect(seedContent).toContain("LIN-123");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes planDir and slug to runScoper", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-test-"));
    const planDir = path.join(tmpDir, "plans");
    fs.mkdirSync(planDir, { recursive: true });

    let capturedScoperOpts: unknown = null;

    await runInteractiveAutopilot("/tmp/repo", undefined, {
      promptGoal: async () => "Build a dashboard",
      promptTicketRef: async () => "",
      getPlanDir: async (_cwd) => planDir,
      mkdirSync: (p, o) => fs.mkdirSync(p, o),
      writeFileSync: (p, c) => fs.writeFileSync(p, c),
      runScoper: async (opts) => {
        capturedScoperOpts = opts;
        return { scopePath: path.join(planDir, "build-a-dashboard", "scope.md") };
      },
      runPlan: async (_opts) => ({
        planPath: path.join(planDir, "build-a-dashboard.md"),
      }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    });

    expect(capturedScoperOpts).toMatchObject({
      planDir,
      slug: "build-a-dashboard",
      initialGoal: "Build a dashboard",
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("propagates error from scoper phase", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-test-"));
    const planDir = path.join(tmpDir, "plans");
    fs.mkdirSync(planDir, { recursive: true });

    await expect(
      runInteractiveAutopilot("/tmp/repo", undefined, {
        promptGoal: async () => "Build something",
        promptTicketRef: async () => "",
        getPlanDir: async (_cwd) => planDir,
        mkdirSync: (p, o) => fs.mkdirSync(p, o),
        writeFileSync: (p, c) => fs.writeFileSync(p, c),
        runScoper: async (_opts) => {
          throw new Error("Scoper failed");
        },
        runPlan: async (_opts) => ({ planPath: "/plans/feat.md" }),
        runLoop: async (_opts) => ({
          exitReason: "sentinel",
          iterations: 1,
          message: "Done",
        }),
      }),
    ).rejects.toThrow("Scoper failed");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes plan content to scoper when planPath provided", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-test-"));
    const planDir = path.join(tmpDir, "plans");
    fs.mkdirSync(planDir, { recursive: true });

    // Write a plan file with a title
    const planFile = path.join(tmpDir, "my-plan.md");
    fs.writeFileSync(planFile, "# Add OAuth login\n\n## Goal\n\nAdd OAuth login support.\n");

    let capturedScoperOpts: unknown = null;

    await runInteractiveAutopilot("/tmp/repo", planFile, {
      getPlanDir: async (_cwd) => planDir,
      mkdirSync: (p, o) => fs.mkdirSync(p, o),
      writeFileSync: (p, c) => fs.writeFileSync(p, c),
      runScoper: async (opts) => {
        capturedScoperOpts = opts;
        return { scopePath: path.join(planDir, "add-oauth-login", "scope.md") };
      },
      runPlan: async (_opts) => ({
        planPath: path.join(planDir, "add-oauth-login.md"),
      }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    });

    expect(capturedScoperOpts).toMatchObject({
      existingPlanContent: expect.stringContaining("Add OAuth login"),
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("derives goal from plan title when planPath provided", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-test-"));
    const planDir = path.join(tmpDir, "plans");
    fs.mkdirSync(planDir, { recursive: true });

    const planFile = path.join(tmpDir, "my-plan.md");
    fs.writeFileSync(planFile, "# Add OAuth login\n\nSome content.\n");

    let capturedScoperOpts: unknown = null;
    let promptGoalCalled = false;

    await runInteractiveAutopilot("/tmp/repo", planFile, {
      getPlanDir: async (_cwd) => planDir,
      mkdirSync: (p, o) => fs.mkdirSync(p, o),
      writeFileSync: (p, c) => fs.writeFileSync(p, c),
      promptGoal: async () => {
        promptGoalCalled = true;
        return "should not be called";
      },
      runScoper: async (opts) => {
        capturedScoperOpts = opts;
        return { scopePath: path.join(planDir, "add-oauth-login", "scope.md") };
      },
      runPlan: async (_opts) => ({
        planPath: path.join(planDir, "add-oauth-login.md"),
      }),
      runLoop: async (_opts) => ({
        exitReason: "sentinel",
        iterations: 1,
        message: "Done",
      }),
    });

    // Goal prompt must NOT have been called
    expect(promptGoalCalled).toBe(false);
    // Goal derived from plan title
    expect(capturedScoperOpts).toMatchObject({
      initialGoal: "Add OAuth login",
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
