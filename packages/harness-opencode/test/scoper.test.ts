/**
 * Tests for the scoper session runner.
 *
 * Mocks the child process to verify:
 *   - Sentinel detection (SCOPE_COMPLETE: <path>)
 *   - Timeout behavior
 *   - scope.md path extraction
 *   - Error propagation
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  extractScopeCompletePath,
  runScoperSession,
} from "../src/autopilot/scoper.js";
import type { StartedServer } from "../src/lib/opencode-server.js";

describe("extractScopeCompletePath", () => {
  it("extracts path from SCOPE_COMPLETE sentinel line", () => {
    const output = "Some output\nSCOPE_COMPLETE: /path/to/scope.md\n";
    expect(extractScopeCompletePath(output)).toBe("/path/to/scope.md");
  });

  it("extracts path when sentinel is the only line", () => {
    const output = "SCOPE_COMPLETE: /abs/path/scope.md";
    expect(extractScopeCompletePath(output)).toBe("/abs/path/scope.md");
  });

  it("returns null when no sentinel present", () => {
    const output = "Some output without sentinel\nMore output\n";
    expect(extractScopeCompletePath(output)).toBeNull();
  });

  it("returns null on empty string", () => {
    expect(extractScopeCompletePath("")).toBeNull();
  });

  it("handles path with spaces (trimmed)", () => {
    const output = "SCOPE_COMPLETE:   /path/with/spaces/scope.md  \n";
    expect(extractScopeCompletePath(output)).toBe("/path/with/spaces/scope.md");
  });

  it("uses last SCOPE_COMPLETE line if multiple present", () => {
    const output =
      "SCOPE_COMPLETE: /first/scope.md\nSCOPE_COMPLETE: /second/scope.md\n";
    expect(extractScopeCompletePath(output)).toBe("/second/scope.md");
  });
});

// ---------------------------------------------------------------------------
// runScoperSession — DI-based integration tests
// ---------------------------------------------------------------------------

/** Build a minimal fake StartedServer for DI. */
function makeFakeServer(overrides?: Partial<StartedServer>): StartedServer {
  return {
    url: "http://127.0.0.1:9999",
    client: {} as StartedServer["client"],
    shutdown: async () => {},
    ...overrides,
  };
}

describe("runScoperSession", () => {
  it("returns scopePath when sentinel is present in last assistant message", async () => {
    const fakeServer = makeFakeServer();

    const result = await runScoperSession({
      planDir: "/tmp/plans",
      slug: "my-feature",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
        getLastAssistantMessage: async (_client, _sessionId) =>
          "I have written the scope.\nSCOPE_COMPLETE: /tmp/plans/my-feature/scope.md",
      },
    });

    expect(result.scopePath).toBe("/tmp/plans/my-feature/scope.md");
  });

  it("throws when session completes but no sentinel is emitted", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          getLastAssistantMessage: async (_client, _sessionId) =>
            "I have written the scope but forgot the sentinel.",
        },
      }),
    ).rejects.toThrow("SCOPE_COMPLETE sentinel");
  });

  it("throws on session abort (timeout)", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({ kind: "abort" }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
        },
      }),
    ).rejects.toThrow("aborted");
  });

  it("throws on session stall", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({
            kind: "stall",
            stallMs: 30000,
          }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
        },
      }),
    ).rejects.toThrow("stalled");
  });

  it("throws on session error", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({
            kind: "error",
            message: "network failure",
          }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
        },
      }),
    ).rejects.toThrow("network failure");
  });

  it("shuts down server even when session throws", async () => {
    let shutdownCalled = false;
    const fakeServer = makeFakeServer({
      shutdown: async () => {
        shutdownCalled = true;
      },
    });

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => {
            throw new Error("createSession failed");
          },
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
        },
      }),
    ).rejects.toThrow("createSession failed");

    expect(shutdownCalled).toBe(true);
  });

  it("passes autoRejectPermissions: false to sendAndWait (scoper is interactive)", async () => {
    const fakeServer = makeFakeServer();
    let capturedAutoReject: boolean | undefined = undefined;

    await runScoperSession({
      planDir: "/tmp/plans",
      slug: "my-feature",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, opts) => {
          capturedAutoReject = opts.autoRejectPermissions;
          return { kind: "idle" };
        },
        getLastAssistantMessage: async (_client, _sessionId) =>
          "SCOPE_COMPLETE: /tmp/plans/my-feature/scope.md",
      },
    });

    expect(capturedAutoReject).toBe(false);
  });
});
