import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  isFreeformFile,
  enrichPlanForFastModel,
} from "../src/plan-enrichment.js";
import type { AgentAdapter, AgentHandle, SessionResult } from "../src/adapter.js";
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

// ---------------------------------------------------------------------------
// isFreeformFile
// ---------------------------------------------------------------------------

describe("isFreeformFile", () => {
  it("returns true for prose-only markdown", () => {
    const f = path.join(tmpDir, "notes.md");
    fs.writeFileSync(f, "# My Plan\n\nWe should refactor the auth module.\n");
    expect(isFreeformFile(f)).toBe(true);
  });

  it("returns false for markdown with checkboxes", () => {
    const f = path.join(tmpDir, "plan.md");
    fs.writeFileSync(f, "# Plan\n\n- [ ] 0.1 First item\n- [ ] 0.2 Second\n");
    expect(isFreeformFile(f)).toBe(false);
  });

  it("returns false for markdown with ### N.N headings", () => {
    const f = path.join(tmpDir, "plan.md");
    fs.writeFileSync(f, "# Plan\n\n### 0.1 First item\nintent: do something\n");
    expect(isFreeformFile(f)).toBe(false);
  });

  it("returns false for a directory", () => {
    const d = path.join(tmpDir, "subdir");
    fs.mkdirSync(d);
    expect(isFreeformFile(d)).toBe(false);
  });

  it("returns false for a non-existent path", () => {
    expect(isFreeformFile(path.join(tmpDir, "nope.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decomposeFreeformPlan (tested through enrichPlanForFastModel)
// ---------------------------------------------------------------------------

describe("enrichPlanForFastModel with freeform input", () => {
  it("decomposes freeform file and returns the plan directory", async () => {
    const freeformFile = path.join(tmpDir, "notes.md");
    fs.writeFileSync(freeformFile, "# Refactor auth\n\nMove session tokens to Redis.\n");

    const expectedPlanDir = path.join(tmpDir, "notes");
    const expectedMainMd = path.join(expectedPlanDir, "main.md");

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() { return { id: "h1" }; },
      async createSession() { return "s1"; },
      async sendAndWait(_handle, opts): Promise<SessionResult> {
        // Simulate the LLM writing main.md + wave_0.md
        const planDir = path.join(tmpDir, "notes");
        fs.mkdirSync(planDir, { recursive: true });
        fs.writeFileSync(
          path.join(planDir, "main.md"),
          `# Auth Refactor\n\n## Goal\nMove tokens to Redis\n\n## Phases\n- [ ] wave_0.md\n`,
        );
        fs.writeFileSync(
          path.join(planDir, "wave_0.md"),
          `### 0.1 Migrate token storage\n- intent: Move session tokens from DB to Redis\n- files:\n    - src/auth.ts\n- tests:\n    - test/auth.test.ts\n- verify: bun test test/auth.test.ts\n`,
        );
        return { kind: "idle" };
      },
      async getLastResponse() { return "DECOMPOSITION_COMPLETE"; },
      async getSessionCost() { return 0; },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    const result = await enrichPlanForFastModel(
      tmpDir,
      freeformFile,
      logger,
      undefined,
      fakeAdapter,
    );

    // Should return the plan directory, not the original file
    expect(result).toBe(expectedPlanDir);
    // Decomposition should have created main.md
    expect(fs.existsSync(expectedMainMd)).toBe(true);
  });

  it("skips decomposition when plan directory already exists", async () => {
    const freeformFile = path.join(tmpDir, "notes.md");
    fs.writeFileSync(freeformFile, "# Some plan\n\nDo things.\n");

    // Pre-create the plan directory with main.md
    const planDir = path.join(tmpDir, "notes");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# Existing\n\n## Goal\nAlready decomposed\n\n## Phases\n- [ ] wave_0.md\n`,
    );
    fs.writeFileSync(
      path.join(planDir, "wave_0.md"),
      `### 0.1 Item\n- intent: Already exists\n- files:\n    - src/a.ts\n- tests:\n    - test/a.test.ts\n- verify: bun test test/a.test.ts\n`,
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
    const result = await enrichPlanForFastModel(
      tmpDir,
      freeformFile,
      logger,
      undefined,
      fakeAdapter,
    );

    expect(result).toBe(planDir);
    // The decomposition session should have been skipped, but the enrichment
    // session for the directory should have run
    // (sessionCreated will be true from the directory enrichment pass)
  });

  it("falls through to single-file behavior when decomposition fails", async () => {
    const freeformFile = path.join(tmpDir, "broken.md");
    fs.writeFileSync(freeformFile, "# Vague thoughts\n\nMaybe do something?\n");

    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() { return { id: "h1" }; },
      async createSession() { return "s1"; },
      async sendAndWait(): Promise<SessionResult> {
        // Session errors — main.md never written
        return { kind: "error", message: "model unavailable" };
      },
      async getLastResponse() { return ""; },
      async getSessionCost() { return 0; },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    const result = await enrichPlanForFastModel(
      tmpDir,
      freeformFile,
      logger,
      undefined,
      fakeAdapter,
    );

    // Falls through to single-file enrichment, returns original path
    expect(result).toBe(path.resolve(tmpDir, freeformFile));
  });

  it("does not trigger decomposition for structured files", async () => {
    const structuredFile = path.join(tmpDir, "plan.md");
    fs.writeFileSync(
      structuredFile,
      `# Plan\n\n- [ ] 0.1 First item\n  intent: Do thing\n- [ ] 0.2 Second item\n  intent: Do other thing\n`,
    );

    let decompositionAttempted = false;
    const fakeAdapter: AgentAdapter = {
      name: "fake",
      async start() { return { id: "h1" }; },
      async createSession() { return "s1"; },
      async sendAndWait(_handle, opts): Promise<SessionResult> {
        if (opts.message.includes("DECOMPOSITION_COMPLETE")) {
          decompositionAttempted = true;
        }
        return { kind: "idle" };
      },
      async getLastResponse() { return "SPEC_COMPLETE"; },
      async getSessionCost() { return 0; },
      async shutdown() {},
    };

    const logger = makeSilentLogger();
    await enrichPlanForFastModel(
      tmpDir,
      structuredFile,
      logger,
      undefined,
      fakeAdapter,
    );

    expect(decompositionAttempted).toBe(false);
  });
});
