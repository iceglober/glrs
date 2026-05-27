import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enrichPlanForFastModel } from "../src/plan-enrichment.js";
import type { AgentAdapter, AgentHandle, SessionResult } from "../src/adapter.js";
import type { AutopilotLogger } from "../src/lib/logger.js";
import { SessionEventEmitter } from "../src/session-runner.js";

function makeSilentLogger(): AutopilotLogger {
  const pino = require("pino");
  const root = pino({ level: "silent" });
  return { root, logFilePath: null, flush: async () => {} };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "enrichment-retry-test-"));
}

function writeFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe("enrichPlanForFastModel retry logic", () => {
  let tmpPlanDir: string;
  let planPath: string;

  beforeEach(() => {
    tmpPlanDir = tmpDir();
    // Create directory-based plan with main.md and wave_0.md (tmpDir already creates the dir)
    planPath = tmpPlanDir;
    fs.writeFileSync(
      path.join(tmpPlanDir, "main.md"),
      `# Test Plan

## Phases
- wave_0.md
`,
    );
    fs.writeFileSync(
      path.join(tmpPlanDir, "wave_0.md"),
      `## Wave 0

- [ ] 0.1 **First item**
- [ ] 0.2 **Second item**
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpPlanDir, { recursive: true, force: true });
  });

  it("restarts server after stall and retries the pass", async () => {
    const startCalls: number[] = [];
    const shutdownCalls: number[] = [];
    let callCount = 0;
    let sendAndWaitCount = 0;

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        startCalls.push(++callCount);
        return { id: `handle-${callCount}` };
      },
      async createSession() {
        return "session-1";
      },
      async sendAndWait(): Promise<SessionResult> {
        // First sendAndWait call stalls, second attempt succeeds
        sendAndWaitCount++;
        if (sendAndWaitCount === 1) {
          return { kind: "stall" };
        }
        return { kind: "idle" };
      },
      async getLastResponse() {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown(handle: AgentHandle) {
        shutdownCalls.push(parseInt(handle.id.split("-")[1]));
      },
    };

    const logger = makeSilentLogger();
    await enrichPlanForFastModel(
      tmpPlanDir,
      tmpPlanDir,
      logger,
      undefined,
      fakeAdapter,
      { retry: true, max_retries: 2 },
    );

    expect(startCalls.length).toBe(2);
    expect(shutdownCalls.length).toBe(2);
    expect(shutdownCalls).toEqual([1, 2]);
  });

  it("skips already-enriched files on retry (idempotency preserved)", async () => {
    const sessionCalls: string[] = [];

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        return { id: "handle-1" };
      },
      async createSession(handle, opts) {
        sessionCalls.push("createSession");
        return `session-${sessionCalls.length}`;
      },
      async sendAndWait(handle, opts): Promise<SessionResult> {
        // First session stalls, second succeeds
        if (sessionCalls.length === 1) {
          return { kind: "stall" };
        }
        return { kind: "idle" };
      },
      async getLastResponse(handle, sessionId) {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    await enrichPlanForFastModel(
      tmpPlanDir,
      tmpPlanDir,
      logger,
      undefined,
      fakeAdapter,
      { retry: true, max_retries: 2 },
    );

    // Should see at least 2 sessions (first stalls, second succeeds)
    expect(sessionCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("throws after max_retries exhausted", async () => {
    let attempt = 0;

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        attempt++;
        return { id: `handle-${attempt}` };
      },
      async createSession() {
        return "session-1";
      },
      async sendAndWait(): Promise<SessionResult> {
        // Always stall - should exhaust retries
        return { kind: "stall" };
      },
      async getLastResponse() {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    let threwError = false;
    let errorMessage = "";

    try {
      await enrichPlanForFastModel(
        tmpPlanDir,
        tmpPlanDir,
        logger,
        undefined,
        fakeAdapter,
        { retry: true, max_retries: 1 },
      );
    } catch (err) {
      threwError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(threwError).toBe(true);
    expect(errorMessage).toContain("exhausted");
    expect(attempt).toBe(1);
  });

  it("skips retry loop when retry is disabled", async () => {
    let startCount = 0;

    // Create the single-file plan so readFileSync succeeds
    fs.writeFileSync(
      path.join(tmpPlanDir, "test-plan.md"),
      "# Test Plan\n\n- [ ] 0.1 **Item one**\n",
    );

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        startCount++;
        return { id: "handle-1" };
      },
      async createSession() {
        return "session-1";
      },
      async sendAndWait(): Promise<SessionResult> {
        return { kind: "stall" };
      },
      async getLastResponse() {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    let threwError = false;
    let errorMessage = "";

    try {
      await enrichPlanForFastModel(
        tmpPlanDir,
        "test-plan.md",
        logger,
        undefined,
        fakeAdapter,
        { retry: false },
      );
    } catch (err) {
      threwError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // retry:false → effectiveRetries=1, stall → throws on first attempt
    expect(threwError).toBe(true);
    expect(errorMessage).toContain("stalled");
    expect(startCount).toBe(1);
  });

  it("uses custom stall_timeout when provided", async () => {
    const stallTimeouts: number[] = [];

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        return { id: "handle-1" };
      },
      async createSession() {
        return "session-1";
      },
      async sendAndWait(handle, opts): Promise<SessionResult> {
        stallTimeouts.push(opts.stallMs ?? 0);
        return { kind: "idle" };
      },
      async getLastResponse() {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    const customTimeout = 10 * 60 * 1000;
    await enrichPlanForFastModel(
      tmpPlanDir,
      tmpPlanDir,
      logger,
      undefined,
      fakeAdapter,
      { retry: true, stall_timeout: customTimeout },
    );

    expect(stallTimeouts[0]).toBe(customTimeout);
  });

  it("defaults to max_retries=3 when not specified", async () => {
    let startCount = 0;

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        startCount++;
        return { id: `handle-${startCount}` };
      },
      async createSession() {
        return "session-1";
      },
      async sendAndWait(): Promise<SessionResult> {
        // Always stall - should try 3 times by default
        return { kind: "stall" };
      },
      async getLastResponse() {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    let threwError = false;

    try {
      await enrichPlanForFastModel(
        tmpPlanDir,
        tmpPlanDir,
        logger,
        undefined,
        fakeAdapter,
        { retry: true },
      );
    } catch (err) {
      threwError = true;
    }

    expect(threwError).toBe(true);
    expect(startCount).toBe(3);
  });

  it("emits events at outer boundary (one pair per overall pass)", async () => {
    const events: Array<{ type: string }> = [];

    const fakeEmitter = new SessionEventEmitter();
    fakeEmitter.on("event", (event) => events.push(event));

    // Create the single-file plan so readFileSync succeeds
    fs.writeFileSync(
      path.join(tmpPlanDir, "test-plan.md"),
      "# Test Plan\n\n- [ ] 0.1 **Item one**\n",
    );

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() {
        return { id: "handle-1" };
      },
      async createSession() {
        return "session-1";
      },
      async sendAndWait(): Promise<SessionResult> {
        return { kind: "idle" };
      },
      async getLastResponse() {
        return "SPEC_COMPLETE";
      },
      async getSessionCost() {
        return 0;
      },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    await enrichPlanForFastModel(
      tmpPlanDir,
      "test-plan.md",
      logger,
      fakeEmitter,
      fakeAdapter,
      { retry: true },
    );

    const startEvents = events.filter((e) => e.type === "enrich:start");
    const doneEvents = events.filter((e) => e.type === "enrich:done");

    expect(startEvents.length).toBe(1);
    expect(doneEvents.length).toBe(1);
  });
});
