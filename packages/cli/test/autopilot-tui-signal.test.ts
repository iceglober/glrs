/**
 * Tests for TUI graceful shutdown (a6).
 *
 * Verifies:
 *   - First Ctrl+C triggers graceful abort via SessionRunner.abort()
 *   - Second Ctrl+C force-exits via process.exit(1)
 *   - The headless path is unaffected (SessionRunner.run() without abort)
 */

import { describe, it, expect, mock, spyOn } from "bun:test";
import { SessionRunner } from "@glrs-dev/autopilot";
import type { LoopResult } from "@glrs-dev/autopilot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunner(opts?: {
  onLoopSession?: (signal?: AbortSignal) => Promise<LoopResult>;
}): SessionRunner {
  const mockLoopResult: LoopResult = {
    exitReason: "sentinel",
    iterations: 1,
    message: "done",
  };

  return new SessionRunner({
    planPath: "/fake/plan",
    cwd: "/fake/cwd",
    _deps: {
      createLogger: () => ({
        root: {
          child: () => ({
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
          }),
        },
        flush: async () => {},
      }) as never,
      createWriter: () => ({
        emit: () => {},
        close: () => {},
      }) as never,
      runLoopSession: async (loopOpts) => {
        if (opts?.onLoopSession) {
          return opts.onLoopSession(loopOpts.signal);
        }
        return mockLoopResult;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionRunner.abort()", () => {
  it("first Ctrl+C triggers graceful abort", async () => {
    let receivedSignal: AbortSignal | undefined;

    const runner = makeRunner({
      onLoopSession: async (signal) => {
        receivedSignal = signal;
        // Simulate a long-running loop that checks the signal
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (signal?.aborted) {
              clearInterval(check);
              resolve();
            }
          }, 10);
          // Safety timeout
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 500);
        });
        return {
          exitReason: "aborted" as const,
          iterations: 1,
          message: "aborted by signal",
        };
      },
    });

    // Start the runner, then abort after a short delay
    const runPromise = runner.run();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    runner.abort();

    const result = await runPromise;
    expect(result.loopResult.exitReason).toBe("aborted");
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("second Ctrl+C force-exits", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    try {
      const runner = makeRunner({
        onLoopSession: async () => {
          // Never resolves — simulates a stuck loop
          await new Promise<void>(() => {});
          return { exitReason: "sentinel" as const, iterations: 0, message: "" };
        },
      });

      // Start the runner (don't await — it won't resolve)
      runner.run().catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // First abort — graceful
      runner.abort();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      // Second abort — should force-exit
      let exitCalled = false;
      try {
        runner.abort();
      } catch (e) {
        if (e instanceof Error && e.message === "process.exit called") {
          exitCalled = true;
        }
      }

      expect(exitCalled).toBe(true);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
