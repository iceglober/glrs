/**
 * Tests for the scoper wizard loop.
 *
 * Covers:
 *   - parseQuestion: regex contract for question detection
 *   - extractScopeCompletePath: sentinel extraction
 *   - runScoperSession: wizard loop via DI mocks
 *     - Happy path: 3 questions answered, then sentinel, scope.md exists
 *     - Parse error: retry once with reminder; second response valid → succeed
 *     - Parse error: retry once; second response also invalid → throw
 *     - Hard cap: 8 questions asked; agent emits sentinel on forced-finalize → succeed
 *     - Hard cap: agent ignores forced-finalize → throw
 *     - Sentinel emitted but file doesn't exist → throw
 *     - Session abort/stall/error propagation
 *     - Server shutdown in finally
 *     - autoRejectPermissions: true verification
 */

import { describe, it, expect } from "bun:test";
import {
  parseQuestion,
  extractScopeCompletePath,
  runScoperSession,
} from "../src/autopilot/scoper.js";
import type { StartedServer } from "../src/lib/opencode-server.js";

// ---------------------------------------------------------------------------
// parseQuestion
// ---------------------------------------------------------------------------

describe("parseQuestion", () => {
  it("returns the question for a valid single-line question ending with '?'", () => {
    expect(parseQuestion("What problem are you solving?")).toBe(
      "What problem are you solving?",
    );
  });

  it("returns null for a response that does not end with '?'", () => {
    expect(parseQuestion("I have written the scope.")).toBeNull();
  });

  it("returns null for a multi-line response", () => {
    expect(parseQuestion("First line.\nWhat is your goal?")).toBeNull();
  });

  it("returns null for a question longer than 200 characters", () => {
    // 201 chars total (200 'a' + '?') — exceeds the 200-char limit
    const long = "a".repeat(200) + "?";
    expect(parseQuestion(long)).toBeNull();
  });

  it("accepts a question of exactly 200 characters", () => {
    // 199 'a' chars + '?' = 200 chars total — at the limit, should be accepted
    const q = "a".repeat(199) + "?";
    expect(parseQuestion(q)).toBe(q);
  });

  it("returns null for empty string", () => {
    expect(parseQuestion("")).toBeNull();
  });

  it("trims trailing whitespace before matching", () => {
    expect(parseQuestion("What is your goal?   ")).toBe("What is your goal?");
  });

  it("returns null for SCOPE_COMPLETE sentinel", () => {
    expect(parseQuestion("SCOPE_COMPLETE: /path/to/scope.md")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractScopeCompletePath
// ---------------------------------------------------------------------------

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
// runScoperSession — DI-based wizard-loop tests
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
  it("happy path: 3 questions answered, then sentinel, scope.md exists → returns path", async () => {
    const fakeServer = makeFakeServer();
    const scopePath = "/tmp/plans/my-feature/scope.md";

    // Sequence of agent responses: Q1, Q2, Q3, sentinel
    const agentResponses = [
      "What problem are you solving?",
      "What does success look like?",
      "Are there any hard constraints?",
      `SCOPE_COMPLETE: ${scopePath}`,
    ];
    let responseIndex = 0;
    const userAnswers: string[] = [];

    const result = await runScoperSession({
      planDir: "/tmp/plans",
      slug: "my-feature",
      initialGoal: "Build a new dashboard",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
        getLastAssistantMessage: async (_client, _sessionId) => {
          const response = agentResponses[responseIndex++] ?? "";
          return response;
        },
        promptUser: async (question: string) => {
          userAnswers.push(question);
          return `Answer to: ${question}`;
        },
        existsSync: (_p: string) => true,
      },
    });

    expect(result.scopePath).toBe(scopePath);
    // 3 questions should have been asked
    expect(userAnswers).toHaveLength(3);
    expect(userAnswers[0]).toBe("What problem are you solving?");
    expect(userAnswers[1]).toBe("What does success look like?");
    expect(userAnswers[2]).toBe("Are there any hard constraints?");
  });

  it("parse error: retry once with reminder; second response valid → succeed", async () => {
    const fakeServer = makeFakeServer();
    const scopePath = "/tmp/plans/feat/scope.md";

    // First response is invalid prose, second is a valid question, then sentinel
    const agentResponses = [
      "I will now ask you some questions about your feature.", // invalid
      "What is the primary user action?", // valid question after retry
      `SCOPE_COMPLETE: ${scopePath}`,
    ];
    let responseIndex = 0;

    const result = await runScoperSession({
      planDir: "/tmp/plans",
      slug: "feat",
      initialGoal: "Build something",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
        getLastAssistantMessage: async (_client, _sessionId) => {
          const response = agentResponses[responseIndex++] ?? "";
          return response;
        },
        promptUser: async (_question: string) => "My answer",
        existsSync: (_p: string) => true,
      },
    });

    expect(result.scopePath).toBe(scopePath);
  });

  it("parse error: retry once; second response also invalid → throw", async () => {
    const fakeServer = makeFakeServer();

    // Both responses are invalid prose
    const agentResponses = [
      "Let me think about this feature.", // invalid
      "I will help you scope this out.", // still invalid after retry
    ];
    let responseIndex = 0;

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "feat",
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          getLastAssistantMessage: async (_client, _sessionId) => {
            const response = agentResponses[responseIndex++] ?? "";
            return response;
          },
          promptUser: async (_question: string) => "My answer",
          existsSync: (_p: string) => true,
        },
      }),
    ).rejects.toThrow("strict contract after retry");
  });

  it("hard cap: 8 questions asked; agent emits sentinel on forced-finalize → succeed", async () => {
    const fakeServer = makeFakeServer();
    const scopePath = "/tmp/plans/feat/scope.md";

    // 8 questions, then sentinel after forced-finalize
    const questions = Array.from(
      { length: 8 },
      (_, i) => `Question number ${i + 1}?`,
    );
    // After 8 questions, the wizard sends forced-finalize; agent responds with sentinel
    const agentResponses = [...questions, `SCOPE_COMPLETE: ${scopePath}`];
    let responseIndex = 0;

    const result = await runScoperSession({
      planDir: "/tmp/plans",
      slug: "feat",
      initialGoal: "Build something",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
        getLastAssistantMessage: async (_client, _sessionId) => {
          const response = agentResponses[responseIndex++] ?? "";
          return response;
        },
        promptUser: async (_question: string) => "My answer",
        existsSync: (_p: string) => true,
      },
    });

    expect(result.scopePath).toBe(scopePath);
  });

  it("hard cap: agent ignores forced-finalize → throw", async () => {
    const fakeServer = makeFakeServer();

    // 8 questions, then another question after forced-finalize (no sentinel)
    const questions = Array.from(
      { length: 8 },
      (_, i) => `Question number ${i + 1}?`,
    );
    const agentResponses = [...questions, "One more question?"];
    let responseIndex = 0;

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "feat",
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          getLastAssistantMessage: async (_client, _sessionId) => {
            const response = agentResponses[responseIndex++] ?? "";
            return response;
          },
          promptUser: async (_question: string) => "My answer",
          existsSync: (_p: string) => true,
        },
      }),
    ).rejects.toThrow("SCOPE_COMPLETE after forced finalize");
  });

  it("sentinel emitted but file doesn't exist → throw", async () => {
    const fakeServer = makeFakeServer();
    const scopePath = "/tmp/plans/feat/scope.md";

    const agentResponses = [`SCOPE_COMPLETE: ${scopePath}`];
    let responseIndex = 0;

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "feat",
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          getLastAssistantMessage: async (_client, _sessionId) => {
            const response = agentResponses[responseIndex++] ?? "";
            return response;
          },
          promptUser: async (_question: string) => "My answer",
          existsSync: (_p: string) => false, // file does not exist
        },
      }),
    ).rejects.toThrow("scope.md does not exist");
  });

  it("throws on session abort (timeout) during initial prompt", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({ kind: "abort" }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
          existsSync: (_p: string) => false,
        },
      }),
    ).rejects.toThrow("aborted");
  });

  it("throws on session stall during initial prompt", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({
            kind: "stall",
            stallMs: 30000,
          }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
          existsSync: (_p: string) => false,
        },
      }),
    ).rejects.toThrow("stalled");
  });

  it("throws on session error during initial prompt", async () => {
    const fakeServer = makeFakeServer();

    await expect(
      runScoperSession({
        planDir: "/tmp/plans",
        slug: "my-feature",
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => "session-abc",
          sendAndWait: async (_client, _opts) => ({
            kind: "error",
            message: "network failure",
          }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
          existsSync: (_p: string) => false,
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
        initialGoal: "Build something",
        _deps: {
          startServer: async (_opts) => fakeServer,
          createSession: async (_client, _opts) => {
            throw new Error("createSession failed");
          },
          sendAndWait: async (_client, _opts) => ({ kind: "idle" }),
          getLastAssistantMessage: async (_client, _sessionId) => "",
          existsSync: (_p: string) => false,
        },
      }),
    ).rejects.toThrow("createSession failed");

    expect(shutdownCalled).toBe(true);
  });

  it("passes autoRejectPermissions: true to sendAndWait (defend in depth)", async () => {
    const fakeServer = makeFakeServer();
    const capturedAutoRejects: (boolean | undefined)[] = [];
    const scopePath = "/tmp/plans/my-feature/scope.md";

    await runScoperSession({
      planDir: "/tmp/plans",
      slug: "my-feature",
      initialGoal: "Build something",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, opts) => {
          capturedAutoRejects.push(opts.autoRejectPermissions);
          return { kind: "idle" };
        },
        getLastAssistantMessage: async (_client, _sessionId) =>
          `SCOPE_COMPLETE: ${scopePath}`,
        existsSync: (_p: string) => true,
      },
    });

    // All sendAndWait calls should have autoRejectPermissions: true
    expect(capturedAutoRejects.every((v) => v === true)).toBe(true);
  });

  it("embeds initialGoal in the first prompt sent to the agent", async () => {
    const fakeServer = makeFakeServer();
    const scopePath = "/tmp/plans/my-feature/scope.md";
    const capturedMessages: string[] = [];

    await runScoperSession({
      planDir: "/tmp/plans",
      slug: "my-feature",
      initialGoal: "Build a real-time notification system",
      _deps: {
        startServer: async (_opts) => fakeServer,
        createSession: async (_client, _opts) => "session-abc",
        sendAndWait: async (_client, opts) => {
          capturedMessages.push(opts.message);
          return { kind: "idle" };
        },
        getLastAssistantMessage: async (_client, _sessionId) =>
          `SCOPE_COMPLETE: ${scopePath}`,
        existsSync: (_p: string) => true,
      },
    });

    // The first message should contain the user's goal
    expect(capturedMessages[0]).toContain(
      "Build a real-time notification system",
    );
  });
});
