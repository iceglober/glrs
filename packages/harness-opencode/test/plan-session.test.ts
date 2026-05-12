/**
 * Tests for the plan session runner.
 *
 * DI-based tests verifying:
 *   - Multi-file plan detection (directory with main.md)
 *   - Single-file plan detection (.md file)
 *   - Error when no plan is produced
 *   - Error propagation from session failures
 *   - Server shutdown in finally
 */

import { describe, it, expect } from "bun:test";
import { runPlanSession } from "../src/autopilot/plan-session.js";
import type { StartedServer } from "../src/lib/opencode-server.js";

/** Build a minimal fake StartedServer for DI. */
function makeFakeServer(overrides?: Partial<StartedServer>): StartedServer {
  return {
    url: "http://127.0.0.1:9999",
    client: {} as StartedServer["client"],
    shutdown: async () => {},
    ...overrides,
  };
}

describe("runPlanSession", () => {
  it("returns directory path for multi-file plan (main.md exists)", async () => {
    const fakeServer = makeFakeServer();

    const result = await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-plan",
        sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
        // main.md exists → multi-file plan
        existsSync: (p) => p === "/tmp/plans/feat/main.md",
      },
    });

    expect(result.planPath).toBe("/tmp/plans/feat");
  });

  it("returns .md path for single-file plan", async () => {
    const fakeServer = makeFakeServer();

    const result = await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-plan",
        sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
        // only single-file exists
        existsSync: (p) => p === "/tmp/plans/feat.md",
      },
    });

    expect(result.planPath).toBe("/tmp/plans/feat.md");
  });

  it("throws when no plan file is produced", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-plan",
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          // neither file exists
          existsSync: (_p) => false,
        },
      }),
    ).rejects.toThrow("produced no plan file");
  });

  it("throws on session abort", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-plan",
          sendAndWait: async (_client, _opts) => ({ kind: "abort" }),
          existsSync: (_p) => false,
        },
      }),
    ).rejects.toThrow("aborted");
  });

  it("throws on session stall", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-plan",
          sendAndWait: async (_client, _opts) => ({
            kind: "stall",
            stallMs: 60000,
          }),
          existsSync: (_p) => false,
        },
      }),
    ).rejects.toThrow("stalled");
  });

  it("throws on session error", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-plan",
          sendAndWait: async (_client, _opts) => ({
            kind: "error",
            message: "plan agent crashed",
          }),
          existsSync: (_p) => false,
        },
      }),
    ).rejects.toThrow("plan agent crashed");
  });

  it("shuts down server even when session throws", async () => {
    let shutdownCalled = false;
    const fakeServer = makeFakeServer({
      shutdown: async () => {
        shutdownCalled = true;
      },
    });

    await expect(
      runPlanSession({
        scopePath: "/tmp/plans/feat/scope.md",
        planDir: "/tmp/plans",
        slug: "feat",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => {
            throw new Error("createSession failed");
          },
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          existsSync: (_p) => false,
        },
      }),
    ).rejects.toThrow("createSession failed");

    expect(shutdownCalled).toBe(true);
  });

  it("passes autoRejectPermissions: true to sendAndWait (plan is headless)", async () => {
    const fakeServer = makeFakeServer();
    let capturedAutoReject: boolean | undefined = undefined;

    await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-plan",
        sendAndWait: async (_client, opts) => {
          capturedAutoReject = opts.autoRejectPermissions;
          return { kind: "idle" };
        },
        existsSync: (p) => p === "/tmp/plans/feat.md",
      },
    });

    expect(capturedAutoReject).toBe(true);
  });

  it("includes scope path and slug in the prompt", async () => {
    const fakeServer = makeFakeServer();
    let capturedMessage = "";

    await runPlanSession({
      scopePath: "/tmp/plans/feat/scope.md",
      planDir: "/tmp/plans",
      slug: "feat",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-plan",
        sendAndWait: async (_client, opts) => {
          capturedMessage = opts.message;
          return { kind: "idle" };
        },
        existsSync: (p) => p === "/tmp/plans/feat.md",
      },
    });

    expect(capturedMessage).toContain("/tmp/plans/feat/scope.md");
    expect(capturedMessage).toContain("feat");
  });
});
