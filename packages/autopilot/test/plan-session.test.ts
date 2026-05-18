/**
 * Tests for the plan session runner.
 *
 * DI-based tests verifying:
 *   - Multi-file plan detection (directory with main.md)
 *   - Single-file plan detection (.md file)
 *   - Error when no plan is produced
 *   - Error propagation from session failures
 *   - Agent shutdown in finally
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runPlanSession } from "../src/plan-session.js";
import type { AgentAdapter, AgentHandle, SessionResult as AdapterSessionResult } from "../src/adapter.js";

/** Build a minimal fake AgentHandle. */
function makeFakeHandle(): AgentHandle {
  return { id: "fake-handle-id" };
}

/** Build a mock AgentAdapter for DI. */
function makeMockAdapter(opts: {
  sendAndWaitResult?: AdapterSessionResult;
  onShutdown?: () => void;
  onCreateSession?: () => string;
  onSendAndWait?: (sessionId: string, message: string) => AdapterSessionResult;
}): AgentAdapter {
  const handle = makeFakeHandle();
  return {
    name: "mock",
    start: async (_opts) => handle,
    createSession: async (_handle, _opts) => {
      if (opts.onCreateSession) return opts.onCreateSession();
      return "session-plan";
    },
    sendAndWait: async (_handle, sendOpts) => {
      if (opts.onSendAndWait) return opts.onSendAndWait(sendOpts.sessionId, sendOpts.message);
      return opts.sendAndWaitResult ?? { kind: "idle" };
    },
    getLastResponse: async (_handle, _sessionId) => "",
    getSessionCost: async (_handle, _sessionId) => 0,
    shutdown: async (_handle) => {
      opts.onShutdown?.();
    },
  };
}

describe("runPlanSession", () => {
  it("returns directory path for multi-file plan (main.md exists)", async () => {
    const adapter = makeMockAdapter({});

    const result = await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      adapter,
      _deps: {
        // main.md exists → multi-file plan
        existsSync: (p) => p === "/tmp/plans/feat/main.md",
      },
    });

    expect(result.planPath).toBe("/tmp/plans/feat");
  });

  it("returns .md path for single-file plan", async () => {
    const adapter = makeMockAdapter({});

    const result = await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      adapter,
      _deps: {
        // only single-file exists
        existsSync: (p) => p === "/tmp/plans/feat.md",
      },
    });

    expect(result.planPath).toBe("/tmp/plans/feat.md");
  });

  it("falls back to auto-generated plan when no plan file is produced", async () => {
    const adapter = makeMockAdapter({});
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-session-test-"));

    try {
      const result = await runPlanSession({
        scopePath: path.join(tmpDir, "scope.md"),
        planDir: tmpDir,
        slug: "feat",
        adapter,
        _deps: {
          // neither file exists on first check; real fs for the fallback write
          existsSync: (p) => fs.existsSync(p),
        },
      });

      // The fallback should have written a minimal plan
      expect(result.planPath).toBe(path.join(tmpDir, "feat.md"));
      expect(fs.existsSync(result.planPath)).toBe(true);
      const content = fs.readFileSync(result.planPath, "utf-8");
      expect(content).toContain("auto-generated from scope");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws on session abort", async () => {
    const adapter = makeMockAdapter({ sendAndWaitResult: { kind: "abort" } });

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        adapter,
        _deps: { existsSync: (_p) => false },
      }),
    ).rejects.toThrow("aborted");
  });

  it("throws on session stall", async () => {
    const adapter = makeMockAdapter({ sendAndWaitResult: { kind: "stall", stallMs: 60000 } });

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        adapter,
        _deps: { existsSync: (_p) => false },
      }),
    ).rejects.toThrow("stalled");
  });

  it("throws on session error", async () => {
    const adapter = makeMockAdapter({ sendAndWaitResult: { kind: "error", message: "plan agent crashed" } });

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        adapter,
        _deps: { existsSync: (_p) => false },
      }),
    ).rejects.toThrow("plan agent crashed");
  });

  it("shuts down agent even when session throws", async () => {
    let shutdownCalled = false;
    const adapter = makeMockAdapter({
      onShutdown: () => { shutdownCalled = true; },
      onCreateSession: () => { throw new Error("createSession failed"); },
    });

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        adapter,
        _deps: { existsSync: (_p) => false },
      }),
    ).rejects.toThrow("createSession failed");

    expect(shutdownCalled).toBe(true);
  });

  it("includes scope path and slug in the prompt", async () => {
    let capturedMessage = "";
    const adapter = makeMockAdapter({
      onSendAndWait: (_sessionId, message) => {
        capturedMessage = message;
        return { kind: "idle" };
      },
    });

    await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      adapter,
      _deps: { existsSync: (p) => p === "/tmp/plans/feat.md" },
    });

    expect(capturedMessage).toContain("/tmp/plans/feat/scope.md");
    expect(capturedMessage).toContain("feat");
  });
});
