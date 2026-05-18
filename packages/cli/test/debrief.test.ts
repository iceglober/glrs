/**
 * Tests for the debrief module.
 */

import { describe, it, expect } from "bun:test";
import { runDebrief, shouldRunDebrief } from "../src/commands/debrief.js";
import type { AgentAdapter, AgentHandle } from "@glrs-dev/autopilot";

/** Build a mock AgentAdapter for debrief tests. */
function makeMockAdapter(opts: {
  onCreateSession?: () => Promise<string>;
  onSendAndWait?: (sessionId: string, message: string) => Promise<{ kind: string }>;
  onGetLastResponse?: (sessionId: string) => Promise<string>;
}): { adapter: AgentAdapter; handle: AgentHandle } {
  const handle: AgentHandle = { id: "mock-handle" };
  const adapter: AgentAdapter = {
    name: "mock",
    start: async (_opts) => handle,
    createSession: async (_handle, _opts) => {
      if (opts.onCreateSession) return opts.onCreateSession();
      return "debrief-session-id";
    },
    sendAndWait: async (_handle, sendOpts) => {
      if (opts.onSendAndWait) return opts.onSendAndWait(sendOpts.sessionId, sendOpts.message) as any;
      return { kind: "idle" };
    },
    getLastResponse: async (_handle, sessionId) => {
      if (opts.onGetLastResponse) return opts.onGetLastResponse(sessionId);
      return "";
    },
    getSessionCost: async (_handle, _sessionId) => 0,
    shutdown: async (_handle) => {},
  };
  return { adapter, handle };
}

describe("debrief runs after loop exits with sentinel", () => {
  it("debrief runs after loop exits with sentinel", async () => {
    let debriefSessionCreated = false;
    let debriefMessageSent = false;

    const { adapter, handle } = makeMockAdapter({
      onCreateSession: async () => {
        debriefSessionCreated = true;
        return "debrief-session-id";
      },
      onSendAndWait: async (_sessionId, _message) => {
        debriefMessageSent = true;
        return { kind: "idle" };
      },
      onGetLastResponse: async () => "Debrief output here.",
    });

    await runDebrief({
      agentHandle: { adapter, handle },
      loopResult: {
        exitReason: "sentinel",
        iterations: 3,
        message: "Agent emitted <autopilot-done> at iteration 3.",
        sessionId: "loop-session-id",
        cumulativeCostUsd: 0.42,
      },
      prompt: "implement feature X",
      cwd: "/tmp",
      _deps: {
        execGitDiffStat: async () => "3 files changed",
      },
    });

    expect(debriefSessionCreated).toBe(true);
    expect(debriefMessageSent).toBe(true);
  });
});

describe("debrief gracefully handles session errors", () => {
  it("debrief gracefully handles session errors", async () => {
    const { adapter, handle } = makeMockAdapter({
      onCreateSession: async () => { throw new Error("session error"); },
    });

    // Should not throw — debrief errors are non-fatal
    await expect(
      runDebrief({
        agentHandle: { adapter, handle },
        loopResult: {
          exitReason: "sentinel",
          iterations: 1,
          message: "done",
        },
        prompt: "test",
        cwd: "/tmp",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("debrief receives loop session cost data", () => {
  it("debrief receives loop session cost data", async () => {
    let capturedMessage = "";

    const { adapter, handle } = makeMockAdapter({
      onSendAndWait: async (_sessionId, message) => {
        capturedMessage = message;
        return { kind: "idle" };
      },
      onGetLastResponse: async () => "Debrief output here.",
    });

    await runDebrief({
      agentHandle: { adapter, handle },
      loopResult: {
        exitReason: "sentinel",
        iterations: 5,
        message: "Agent emitted <autopilot-done> at iteration 5.",
        sessionId: "loop-session-id",
        cumulativeCostUsd: 1.23,
      },
      prompt: "implement feature X",
      cwd: "/tmp",
      _deps: {
        execGitDiffStat: async () => "2 files changed",
      },
    });

    // The context message sent to the debriefer must include cost and iteration data
    expect(capturedMessage).toContain("1.23");
    expect(capturedMessage).toContain("5");
    expect(capturedMessage).toContain("sentinel");
  });
});

describe("--no-debrief flag skips debrief", () => {
  it("--no-debrief flag skips debrief", async () => {
    expect(shouldRunDebrief({ noDebrief: true, env: {} })).toBe(false);
    expect(shouldRunDebrief({ noDebrief: false, env: {} })).toBe(true);
  });
});

describe("GLRS_AUTOPILOT_DEBRIEF=off env var skips debrief", () => {
  it("GLRS_AUTOPILOT_DEBRIEF=off env var skips debrief", async () => {
    expect(shouldRunDebrief({ noDebrief: false, env: { GLRS_AUTOPILOT_DEBRIEF: "off" } })).toBe(false);
    expect(shouldRunDebrief({ noDebrief: false, env: { GLRS_AUTOPILOT_DEBRIEF: "on" } })).toBe(true);
    expect(shouldRunDebrief({ noDebrief: false, env: { GLRS_AUTOPILOT_DEBRIEF: "OFF" } })).toBe(false);
  });
});
