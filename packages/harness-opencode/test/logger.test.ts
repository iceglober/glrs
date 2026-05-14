/**
 * Tests for the autopilot logger's two-sink routing.
 *
 * Critical invariants:
 *   - stderr at default (info) hides debug-level tool events
 *   - file sink (trace) captures everything, always
 *   - GLRS_LOG_LEVEL=debug surfaces tool events to stderr
 *   - GLRS_AUTOPILOT_LOG_FILE=off disables file sink entirely
 *   - GLRS_AUTOPILOT_LOG_FILE=<path> overrides default path
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutopilotLogger } from "../src/lib/logger.js";

describe("autopilot logger — two-sink routing", () => {
  const originalEnv = { ...process.env };
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "autopilot-log-test-"));
    // Clear env so each test controls its own config
    delete process.env["GLRS_LOG_LEVEL"];
    delete process.env["GLRS_LOG_FORMAT"];
    delete process.env["GLRS_AUTOPILOT_LOG_FILE"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("creates default log file under .agent/autopilot-logs/", async () => {
    // Force JSON stderr to avoid pino-pretty's worker complicating flush timing
    process.env["GLRS_LOG_FORMAT"] = "json";

    const logger = createAutopilotLogger({ cwd: tmpCwd });
    logger.root.info({ iteration: 1 }, "test event");
    await logger.flush();

    expect(logger.logFilePath).not.toBeNull();
    expect(logger.logFilePath).toContain(".agent/autopilot-logs/");
    expect(logger.logFilePath!.endsWith(".log")).toBe(true);
  });

  it("GLRS_AUTOPILOT_LOG_FILE=off disables file sink", async () => {
    process.env["GLRS_AUTOPILOT_LOG_FILE"] = "off";
    process.env["GLRS_LOG_FORMAT"] = "json";

    const logger = createAutopilotLogger({ cwd: tmpCwd });
    expect(logger.logFilePath).toBeNull();
    await logger.flush();
  });

  it("GLRS_AUTOPILOT_LOG_FILE=<path> uses explicit path", async () => {
    const explicitPath = join(tmpCwd, "custom", "run.log");
    process.env["GLRS_AUTOPILOT_LOG_FILE"] = explicitPath;
    process.env["GLRS_LOG_FORMAT"] = "json";

    const logger = createAutopilotLogger({ cwd: tmpCwd });
    expect(logger.logFilePath).toBe(explicitPath);

    logger.root.info({ iteration: 1 }, "test event");
    await logger.flush();
    // Small delay to let async pino.destination flush to disk
    await new Promise((r) => setTimeout(r, 50));

    expect(existsSync(explicitPath)).toBe(true);
    const contents = readFileSync(explicitPath, "utf-8");
    expect(contents).toContain("test event");
    expect(contents).toContain("\"iteration\":1");
  });

  it("file sink captures debug events even when stderr level is info", async () => {
    const filePath = join(tmpCwd, "run.log");
    process.env["GLRS_AUTOPILOT_LOG_FILE"] = filePath;
    process.env["GLRS_LOG_LEVEL"] = "info";
    process.env["GLRS_LOG_FORMAT"] = "json";

    const logger = createAutopilotLogger({ cwd: tmpCwd });
    logger.root.debug({ tool: "read" }, "tool call");
    logger.root.info({ iteration: 1 }, "iteration");
    await logger.flush();
    await new Promise((r) => setTimeout(r, 50));

    const contents = readFileSync(filePath, "utf-8");
    // Both events present in file (file sink is always trace-level)
    expect(contents).toContain("tool call");
    expect(contents).toContain("iteration");
  });
});
