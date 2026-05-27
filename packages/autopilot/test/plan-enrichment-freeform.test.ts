import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { enrichPlan } from "../src/plan-enrichment.js";
import type { AgentAdapter, SessionResult } from "../src/adapter.js";
import type { AutopilotLogger } from "../src/lib/logger.js";

let tmpDir: string;

function makeSilentLogger(): AutopilotLogger {
  const pino = require("pino");
  const root = pino({ level: "silent" });
  return { root, logFilePath: null, flush: async () => {} };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "freeform-enrichment-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("enrichPlan with single-file input", () => {
  it("creates sibling directory and writes spec files via unified enrichment", async () => {
    const planFile = path.join(tmpDir, "notes.md");
    fs.writeFileSync(planFile, "# Refactor auth\n\nMove session tokens to Redis.\n");

    const expectedPlanDir = path.join(tmpDir, "notes");

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() { return { id: "h1" }; },
      async createSession() { return "s1"; },
      async sendAndWait(_handle, opts): Promise<SessionResult> {
        // Simulate the LLM writing spec files directly
        const specDir = path.join(expectedPlanDir, "spec");
        fs.mkdirSync(specDir, { recursive: true });
        fs.writeFileSync(
          path.join(specDir, "main.yaml"),
          `title: "Auth Refactor"\ngoal: "Move tokens to Redis"\nconstraints: ""\nphases:\n  - file: wave_0.yaml\n    completed: false\n`,
        );
        fs.writeFileSync(
          path.join(specDir, "wave_0.yaml"),
          `items:\n  - id: "0.1"\n    intent: "Migrate token storage"\n    checked: false\n    files:\n      - path: src/auth.ts\n        isNew: false\n        change: "Add Redis client"\n    tests:\n      - "test/auth.test.ts"\n    verify: "bun test test/auth.test.ts"\n    mirror: "src/cache.ts"\n    context: "existing code"\n    conventions: "ESM"\n    proof: "test passes"\n    proof_type: "test"\n`,
        );
        return { kind: "idle" };
      },
      async getLastResponse() { return "SPEC_COMPLETE"; },
      async getSessionCost() { return 0; },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    const result = await enrichPlan(tmpDir, planFile, logger, undefined, fakeAdapter);

    expect(result).toBe(expectedPlanDir);
    expect(fs.existsSync(path.join(expectedPlanDir, "spec", "main.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(expectedPlanDir, "spec", "wave_0.yaml"))).toBe(true);
  });

  it("skips enrichment when spec is already fully enriched", async () => {
    const planFile = path.join(tmpDir, "notes.md");
    fs.writeFileSync(planFile, "# Some plan\n\nDo things.\n");

    // Pre-create the plan directory with fully enriched spec
    const planDir = path.join(tmpDir, "notes");
    const specDir = path.join(planDir, "spec");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "main.yaml"),
      `title: "Existing"\ngoal: "Already done"\nconstraints: ""\nphases:\n  - file: wave_0.yaml\n    completed: false\n`,
    );
    fs.writeFileSync(
      path.join(specDir, "wave_0.yaml"),
      `items:\n  - id: "0.1"\n    intent: "Already exists"\n    checked: false\n    files:\n      - path: src/a.ts\n        isNew: false\n        change: "Edit"\n    tests:\n      - "test/a.test.ts"\n    verify: "bun test"\n    mirror: "src/b.ts"\n    context: "code"\n    conventions: "ESM"\n    proof: "test"\n    proof_type: "test"\n`,
    );

    let sessionCreated = false;
    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() { return { id: "h1" }; },
      async createSession() { sessionCreated = true; return "s1"; },
      async sendAndWait(): Promise<SessionResult> { return { kind: "idle" }; },
      async getLastResponse() { return "SPEC_COMPLETE"; },
      async getSessionCost() { return 0; },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    const result = await enrichPlan(tmpDir, planFile, logger, undefined, fakeAdapter);

    expect(result).toBe(planDir);
    expect(sessionCreated).toBe(false);
  });

  it("throws when unified enrichment session errors after retries", async () => {
    const planFile = path.join(tmpDir, "broken.md");
    fs.writeFileSync(planFile, "# Vague thoughts\n\nMaybe do something?\n");

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() { return { id: "h1" }; },
      async createSession() { return "s1"; },
      async sendAndWait(): Promise<SessionResult> {
        return { kind: "error", message: "model unavailable" };
      },
      async getLastResponse() { return ""; },
      async getSessionCost() { return 0; },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    await expect(
      enrichPlan(tmpDir, planFile, logger, undefined, fakeAdapter, { max_retries: 1 }),
    ).rejects.toThrow("Unified enrichment failed");
  });
});
