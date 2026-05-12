/**
 * Tests for the status-heartbeat helper.
 *
 * Covers:
 *   - composeStatusMessage output shape
 *   - formatElapsed / formatCost formatting
 *   - heartbeat timer actually fires at the configured interval
 *   - update() mutates shared state observed by the tick
 *   - stop() cancels the timer cleanly
 *   - start() is idempotent (multiple calls = single timer)
 */

import { describe, it, expect } from "bun:test";
import pino from "pino";
import {
  createStatusHeartbeat,
  composeStatusMessage,
  formatCost,
  formatElapsed,
  type StatusState,
} from "../src/autopilot/status.js";

function makeLogger(captured: Array<{ level: number; msg: string; obj: Record<string, unknown> }>) {
  return pino(
    { level: "trace" },
    {
      write(chunk: string) {
        const parsed = JSON.parse(chunk) as Record<string, unknown>;
        captured.push({
          level: parsed["level"] as number,
          msg: parsed["msg"] as string,
          obj: parsed,
        });
      },
    },
  );
}

describe("formatElapsed", () => {
  it("formats seconds only when <1 minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(500)).toBe("0s");
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("formats minutes+seconds when <1 hour", () => {
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(5 * 60_000 + 23_000)).toBe("5m 23s");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59m 59s");
  });

  it("formats hours+minutes+seconds when >=1 hour", () => {
    expect(formatElapsed(60 * 60_000)).toBe("1h 0m 0s");
    expect(formatElapsed(3 * 60 * 60_000 + 27 * 60_000 + 15_000)).toBe("3h 27m 15s");
  });
});

describe("formatCost", () => {
  it("renders zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });
  it("renders positive cost with 3 decimal places", () => {
    expect(formatCost(0.001)).toBe("$0.001");
    expect(formatCost(1.234)).toBe("$1.234");
    expect(formatCost(42)).toBe("$42.000");
  });
});

describe("composeStatusMessage", () => {
  const baseState: StatusState = {
    startedAt: 1000,
    iterationsCompleted: 3,
    cumulativeCostUsd: 0.125,
    lastIterationProgress: true,
    lastIterationErrored: false,
  };

  it("reports normal 'working' with iteration/time/cost", () => {
    const now = 1000 + 5 * 60_000; // 5 minutes in
    const msg = composeStatusMessage(baseState, now);
    expect(msg).toBe("working (3 iterations complete, 5m 0s elapsed, $0.125 used)");
  });

  it("reports pluralization correctly for 1 iteration", () => {
    const state = { ...baseState, iterationsCompleted: 1 };
    const msg = composeStatusMessage(state, baseState.startedAt + 1000);
    expect(msg).toBe("working (1 iteration complete, 1s elapsed, $0.125 used)");
  });

  it("reports 'iteration 1 in flight' when none complete yet", () => {
    const state = { ...baseState, iterationsCompleted: 0 };
    const msg = composeStatusMessage(state, baseState.startedAt + 2000);
    expect(msg).toBe("working (iteration 1 in flight, 2s elapsed, $0.125 used)");
  });

  it("surfaces error state in the message", () => {
    const state = { ...baseState, lastIterationErrored: true };
    const msg = composeStatusMessage(state, baseState.startedAt + 1000);
    expect(msg).toContain("last iteration errored");
  });
});

describe("status heartbeat timer behavior", () => {
  it("calls logger.info at the configured interval", async () => {
    const captured: Array<{ level: number; msg: string; obj: Record<string, unknown> }> = [];
    const logger = makeLogger(captured);

    // Fake timer: we run the interval callback manually.
    const intervals: Array<() => void> = [];
    const mockSetInterval = (handler: () => void, _ms: number) => {
      intervals.push(handler);
      return 42 as unknown as ReturnType<typeof setInterval>;
    };
    const mockClearInterval = () => {};

    let fakeNow = 1000;
    const heartbeat = createStatusHeartbeat({
      logger,
      intervalMs: 60_000,
      _deps: {
        now: () => fakeNow,
        setInterval: mockSetInterval,
        clearInterval: mockClearInterval,
      },
    });

    heartbeat.start();
    heartbeat.update({ iterationsCompleted: 2, cumulativeCostUsd: 0.42 });

    // Simulate time passing + a timer tick
    fakeNow = 1000 + 60_000;
    intervals[0]!();

    expect(captured.length).toBe(1);
    expect(captured[0]!.msg).toContain("2 iterations complete");
    expect(captured[0]!.msg).toContain("1m 0s elapsed");
    expect(captured[0]!.msg).toContain("$0.420");
    expect(captured[0]!.obj["iterationsCompleted"]).toBe(2);
    expect(captured[0]!.obj["cumulativeCostUsd"]).toBe(0.42);

    heartbeat.stop();
  });

  it("start() is idempotent", () => {
    const captured: Array<{ level: number; msg: string; obj: Record<string, unknown> }> = [];
    const logger = makeLogger(captured);
    let intervalCount = 0;
    const heartbeat = createStatusHeartbeat({
      logger,
      intervalMs: 60_000,
      _deps: {
        now: () => 0,
        setInterval: () => {
          intervalCount++;
          return intervalCount as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval: () => {},
      },
    });
    heartbeat.start();
    heartbeat.start();
    heartbeat.start();
    expect(intervalCount).toBe(1);
    heartbeat.stop();
  });

  it("stop() is safe when not started", () => {
    const captured: Array<{ level: number; msg: string; obj: Record<string, unknown> }> = [];
    const logger = makeLogger(captured);
    let clearedCount = 0;
    const heartbeat = createStatusHeartbeat({
      logger,
      intervalMs: 60_000,
      _deps: {
        now: () => 0,
        setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
        clearInterval: () => {
          clearedCount++;
        },
      },
    });
    heartbeat.stop();
    expect(clearedCount).toBe(0);
  });
});
