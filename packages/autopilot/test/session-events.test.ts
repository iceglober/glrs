import { describe, it, expect } from "bun:test";
import {
  isSessionStart,
  isSessionDone,
  isEnrichStart,
  isEnrichFileStart,
  isEnrichFileDone,
  isEnrichFileSkip,
  isEnrichFileError,
  isEnrichDone,
  isEnrichEvent,
  isPhaseStart,
  isPhaseDone,
  isIterationStart,
  isIterationDone,
  isToolCall,
  isCostUpdate,
  isError,
  isCredentialExpired,
  isVerifyStart,
  isVerifyResult,
  isVerifyDone,
  isVerifyEvent,
  type SessionEvent,
} from "../src/session-events.js";

const ts = "2026-01-01T00:00:00.000Z";

describe("session-events type guards", () => {
  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  describe("session:start", () => {
    const e: SessionEvent = {
      type: "session:start",
      timestamp: ts,
      planPath: "/plans/foo",
      cwd: "/repo",
      fast: false,
      resume: false,
    };
    it("isSessionStart returns true for session:start", () => {
      expect(isSessionStart(e)).toBe(true);
    });
    it("isSessionDone returns false for session:start", () => {
      expect(isSessionDone(e)).toBe(false);
    });
    it("isEnrichEvent returns false for session:start", () => {
      expect(isEnrichEvent(e)).toBe(false);
    });
  });

  describe("session:done", () => {
    const e: SessionEvent = {
      type: "session:done",
      timestamp: ts,
      exitReason: "sentinel",
      iterations: 3,
      cumulativeCostUsd: 0.12,
      message: "done",
    };
    it("isSessionDone returns true", () => {
      expect(isSessionDone(e)).toBe(true);
    });
    it("isSessionStart returns false", () => {
      expect(isSessionStart(e)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Enrichment
  // ---------------------------------------------------------------------------
  describe("enrich:start", () => {
    const e: SessionEvent = {
      type: "enrich:start",
      timestamp: ts,
      planPath: "/plans/foo",
      fileCount: 3,
    };
    it("isEnrichStart returns true", () => {
      expect(isEnrichStart(e)).toBe(true);
    });
    it("isEnrichEvent returns true", () => {
      expect(isEnrichEvent(e)).toBe(true);
    });
    it("isSessionStart returns false", () => {
      expect(isSessionStart(e)).toBe(false);
    });
  });

  describe("enrich:file:start", () => {
    const e: SessionEvent = {
      type: "enrich:file:start",
      timestamp: ts,
      file: "wave_0.md",
    };
    it("isEnrichFileStart returns true", () => {
      expect(isEnrichFileStart(e)).toBe(true);
    });
    it("isEnrichEvent returns true", () => {
      expect(isEnrichEvent(e)).toBe(true);
    });
    it("isEnrichFileDone returns false", () => {
      expect(isEnrichFileDone(e)).toBe(false);
    });
  });

  describe("enrich:file:done", () => {
    const e: SessionEvent = {
      type: "enrich:file:done",
      timestamp: ts,
      file: "wave_0.md",
      toolCalls: 5,
      specFile: "spec/wave_0.yaml",
    };
    it("isEnrichFileDone returns true", () => {
      expect(isEnrichFileDone(e)).toBe(true);
    });
    it("isEnrichEvent returns true", () => {
      expect(isEnrichEvent(e)).toBe(true);
    });
    it("isEnrichFileStart returns false", () => {
      expect(isEnrichFileStart(e)).toBe(false);
    });
  });

  describe("enrich:file:skip", () => {
    const e: SessionEvent = {
      type: "enrich:file:skip",
      timestamp: ts,
      file: "wave_0.md",
      reason: "already enriched",
    };
    it("isEnrichFileSkip returns true", () => {
      expect(isEnrichFileSkip(e)).toBe(true);
    });
    it("isEnrichEvent returns true", () => {
      expect(isEnrichEvent(e)).toBe(true);
    });
  });

  describe("enrich:file:error", () => {
    const e: SessionEvent = {
      type: "enrich:file:error",
      timestamp: ts,
      file: "wave_0.md",
      error: "session stalled",
    };
    it("isEnrichFileError returns true", () => {
      expect(isEnrichFileError(e)).toBe(true);
    });
    it("isEnrichEvent returns true", () => {
      expect(isEnrichEvent(e)).toBe(true);
    });
  });

  describe("enrich:done", () => {
    const e: SessionEvent = {
      type: "enrich:done",
      timestamp: ts,
      filesProcessed: 3,
    };
    it("isEnrichDone returns true", () => {
      expect(isEnrichDone(e)).toBe(true);
    });
    it("isEnrichEvent returns true", () => {
      expect(isEnrichEvent(e)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------
  describe("phase:start", () => {
    const e: SessionEvent = {
      type: "phase:start",
      timestamp: ts,
      phase: "wave_0.md",
      laneId: "lane-1",
      current: 1,
      total: 3,
    };
    it("isPhaseStart returns true", () => {
      expect(isPhaseStart(e)).toBe(true);
    });
    it("isPhaseDone returns false", () => {
      expect(isPhaseDone(e)).toBe(false);
    });
  });

  describe("phase:done", () => {
    const e: SessionEvent = {
      type: "phase:done",
      timestamp: ts,
      phase: "wave_0.md",
      laneId: "lane-1",
      completed: true,
      iterations: 2,
      costUsd: 0.05,
    };
    it("isPhaseDone returns true", () => {
      expect(isPhaseDone(e)).toBe(true);
    });
    it("isPhaseStart returns false", () => {
      expect(isPhaseStart(e)).toBe(false);
    });
  });

  describe("iteration:start", () => {
    const e: SessionEvent = {
      type: "iteration:start",
      timestamp: ts,
      iteration: 1,
      maxIterations: 10,
    };
    it("isIterationStart returns true", () => {
      expect(isIterationStart(e)).toBe(true);
    });
    it("isIterationDone returns false", () => {
      expect(isIterationDone(e)).toBe(false);
    });
  });

  describe("iteration:done", () => {
    const e: SessionEvent = {
      type: "iteration:done",
      timestamp: ts,
      iteration: 1,
      durationMs: 5000,
      madeProgress: true,
      filesChanged: 2,
      commitSubject: "feat: add foo",
      costUsd: 0.02,
    };
    it("isIterationDone returns true", () => {
      expect(isIterationDone(e)).toBe(true);
    });
    it("isIterationStart returns false", () => {
      expect(isIterationStart(e)).toBe(false);
    });
  });

  describe("tool:call", () => {
    const e: SessionEvent = {
      type: "tool:call",
      timestamp: ts,
      toolName: "bash",
      firstArg: "ls",
      iteration: 1,
    };
    it("isToolCall returns true", () => {
      expect(isToolCall(e)).toBe(true);
    });
    it("isCostUpdate returns false", () => {
      expect(isCostUpdate(e)).toBe(false);
    });
  });

  describe("cost:update", () => {
    const e: SessionEvent = {
      type: "cost:update",
      timestamp: ts,
      cumulativeCostUsd: 0.15,
      isEstimated: false,
      iteration: 2,
    };
    it("isCostUpdate returns true", () => {
      expect(isCostUpdate(e)).toBe(true);
    });
    it("isToolCall returns false", () => {
      expect(isToolCall(e)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------
  describe("error", () => {
    const e: SessionEvent = {
      type: "error",
      timestamp: ts,
      message: "something went wrong",
      iteration: 3,
    };
    it("isError returns true", () => {
      expect(isError(e)).toBe(true);
    });
    it("isCredentialExpired returns false", () => {
      expect(isCredentialExpired(e)).toBe(false);
    });
  });

  describe("credential:expired", () => {
    const e: SessionEvent = {
      type: "credential:expired",
      timestamp: ts,
      provider: "aws",
      message: "Credentials expired. Run `gs-assume`.",
      iteration: 2,
    };
    it("isCredentialExpired returns true", () => {
      expect(isCredentialExpired(e)).toBe(true);
    });
    it("isError returns false", () => {
      expect(isError(e)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------
  describe("verify:start", () => {
    const e: SessionEvent = {
      type: "verify:start",
      timestamp: ts,
      phase: "wave_0.md",
      itemCount: 3,
    };
    it("isVerifyStart returns true", () => {
      expect(isVerifyStart(e)).toBe(true);
    });
    it("isVerifyEvent returns true", () => {
      expect(isVerifyEvent(e)).toBe(true);
    });
    it("isVerifyDone returns false", () => {
      expect(isVerifyDone(e)).toBe(false);
    });
  });

  describe("verify:result", () => {
    const e: SessionEvent = {
      type: "verify:result",
      timestamp: ts,
      phase: "wave_0.md",
      itemId: "0.1",
      command: "bun test",
      passed: true,
    };
    it("isVerifyResult returns true", () => {
      expect(isVerifyResult(e)).toBe(true);
    });
    it("isVerifyEvent returns true", () => {
      expect(isVerifyEvent(e)).toBe(true);
    });
    it("isVerifyStart returns false", () => {
      expect(isVerifyStart(e)).toBe(false);
    });
  });

  describe("verify:done", () => {
    const e: SessionEvent = {
      type: "verify:done",
      timestamp: ts,
      phase: "wave_0.md",
      passed: 3,
      failed: 0,
    };
    it("isVerifyDone returns true", () => {
      expect(isVerifyDone(e)).toBe(true);
    });
    it("isVerifyEvent returns true", () => {
      expect(isVerifyEvent(e)).toBe(true);
    });
    it("isVerifyResult returns false", () => {
      expect(isVerifyResult(e)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-guard: every guard rejects an event of a different type
  // ---------------------------------------------------------------------------
  describe("cross-guard rejections", () => {
    const sessionStart: SessionEvent = {
      type: "session:start",
      timestamp: ts,
      planPath: "/plans/foo",
      cwd: "/repo",
      fast: false,
      resume: false,
    };

    it("isPhaseStart rejects session:start", () => {
      expect(isPhaseStart(sessionStart)).toBe(false);
    });
    it("isIterationStart rejects session:start", () => {
      expect(isIterationStart(sessionStart)).toBe(false);
    });
    it("isToolCall rejects session:start", () => {
      expect(isToolCall(sessionStart)).toBe(false);
    });
    it("isError rejects session:start", () => {
      expect(isError(sessionStart)).toBe(false);
    });
    it("isVerifyEvent rejects session:start", () => {
      expect(isVerifyEvent(sessionStart)).toBe(false);
    });
  });
});
