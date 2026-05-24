import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionRunner } from "../src/session-runner.js";
import { EventStreamReader } from "../src/event-stream.js";
import type { SessionEvent } from "../src/session-events.js";
import type { LoopResult } from "../src/loop.js";
import type { AutopilotLogger } from "../src/lib/logger.js";

const ts = "2026-01-01T00:00:00.000Z";

function makeSilentLogger(): AutopilotLogger {
  const pino = require("pino");
  const root = pino({ level: "silent" });
  return { root, logFilePath: null, flush: async () => {} };
}

function makeSuccessLoopResult(): LoopResult {
  return {
    exitReason: "sentinel",
    iterations: 2,
    message: "Agent emitted <autopilot-done> at iteration 2.",
    cumulativeCostUsd: 0.05,
  };
}

describe("SessionRunner", () => {
  let tmpDir: string;
  let planPath: string;
  let eventStreamPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-runner-test-"));
    planPath = path.join(tmpDir, "plans", "test-plan.md");
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, "# Test Plan\n\n- [ ] item 1\n");
    eventStreamPath = path.join(tmpDir, ".agent", "autopilot-events.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("lifecycle events", () => {
    it("emits session:start and session:done on a successful run", async () => {
      const emitted: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("event", (e: SessionEvent) => emitted.push(e));
      await runner.run();

      expect(emitted[0].type).toBe("session:start");
      expect(emitted[emitted.length - 1].type).toBe("session:done");
    });

    it("session:start carries planPath, cwd, resume", async () => {
      const emitted: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        resume: false,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          enrichPlan: async (_cwd: string, planPath: string) => planPath,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("event", (e: SessionEvent) => emitted.push(e));
      await runner.run();

      const start = emitted.find((e) => e.type === "session:start");
      expect(start).toBeDefined();
      if (start?.type === "session:start") {
        expect(start.planPath).toBe(planPath);
        expect(start.cwd).toBe(tmpDir);
        expect(start.resume).toBe(false);
      }
    });

    it("session:done carries exitReason, iterations, cumulativeCostUsd", async () => {
      const emitted: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("event", (e: SessionEvent) => emitted.push(e));
      await runner.run();

      const done = emitted.find((e) => e.type === "session:done");
      expect(done).toBeDefined();
      if (done?.type === "session:done") {
        expect(done.exitReason).toBe("sentinel");
        expect(done.iterations).toBe(2);
        expect(done.cumulativeCostUsd).toBe(0.05);
      }
    });

    it("emits error event when runLoopSession throws", async () => {
      const emitted: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => {
            throw new Error("loop exploded");
          },
        },
      });

      runner.events.on("event", (e: SessionEvent) => emitted.push(e));
      const result = await runner.run();

      const errorEvent = emitted.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(result.loopResult.exitReason).toBe("error");
    });
  });

  describe("enrichment events", () => {
    it("emits enrich:start and enrich:done", async () => {
      const emitted: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          enrichPlan: async (_cwd: string, planPath: string) => planPath,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("event", (e: SessionEvent) => emitted.push(e));
      await runner.run();

      expect(emitted.some((e) => e.type === "enrich:start")).toBe(true);
      expect(emitted.some((e) => e.type === "enrich:done")).toBe(true);
    });

    it("emits error event when enrichment throws, but continues to execution", async () => {
      const emitted: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          enrichPlan: async () => {
            throw new Error("enrichment failed");
          },
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("event", (e: SessionEvent) => emitted.push(e));
      const result = await runner.run();

      // Error event emitted for enrichment failure
      expect(emitted.some((e) => e.type === "error")).toBe(true);
      // But execution still ran and session:done was emitted
      expect(emitted.some((e) => e.type === "session:done")).toBe(true);
      expect(result.loopResult.exitReason).toBe("sentinel");
    });
  });

  describe("EventStreamWriter integration", () => {
    it("writes events to the NDJSON file", async () => {
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      await runner.run();

      const reader = new EventStreamReader(eventStreamPath);
      const events = reader.readAll();
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].type).toBe("session:start");
      expect(events[events.length - 1].type).toBe("session:done");
    });

    it("events in file match events emitted in-process", async () => {
      const inProcess: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          enrichPlan: async (_cwd: string, p: string) => p,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("event", (e: SessionEvent) => inProcess.push(e));
      await runner.run();

      const reader = new EventStreamReader(eventStreamPath);
      const fromFile = reader.readAll();

      expect(fromFile).toHaveLength(inProcess.length);
      for (let i = 0; i < inProcess.length; i++) {
        expect(fromFile[i].type).toBe(inProcess[i].type);
      }
    });

    it("creates the .agent directory if it does not exist", async () => {
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      await runner.run();

      expect(fs.existsSync(path.dirname(eventStreamPath))).toBe(true);
    });
  });

  describe("return value", () => {
    it("returns planPath and loopResult", async () => {
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      const result = await runner.run();
      expect(result.planPath).toBe(planPath);
      expect(result.loopResult.exitReason).toBe("sentinel");
      expect(result.loopResult.iterations).toBe(2);
    });
  });

  describe("typed event subscriptions", () => {
    it("can subscribe to specific event types", async () => {
      const starts: SessionEvent[] = [];
      const runner = new SessionRunner({
        planPath,
        cwd: tmpDir,
        eventStreamPath,
        _deps: {
          createLogger: makeSilentLogger,
          runLoopSession: async () => makeSuccessLoopResult(),
        },
      });

      runner.events.on("session:start", (e: SessionEvent) => starts.push(e));
      await runner.run();

      expect(starts).toHaveLength(1);
      expect(starts[0].type).toBe("session:start");
    });
  });
});
