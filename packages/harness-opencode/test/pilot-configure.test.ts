/**
 * Tests for pilot v2 config module.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { loadPilotConfig, writePilotConfig, DEFAULT_CONFIG } from "../src/pilot/config.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pilot-config-test-"));
}

describe("pilot config — loadPilotConfig", () => {
  test("returns defaults when no config file exists", () => {
    const dir = makeTmpDir();
    const config = loadPilotConfig(dir);
    expect(config.models.scope).toBe(DEFAULT_CONFIG.models.scope);
    expect(config.models.execute).toBe(DEFAULT_CONFIG.models.execute);
    expect(config.max_assess_cycles).toBe(DEFAULT_CONFIG.max_assess_cycles);
    expect(config.playwright.enabled).toBe(false);
  });

  test("loads a valid config file", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".glrs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".glrs", "pilot.json"),
      JSON.stringify({
        models: { scope: "custom/model", plan: "custom/plan", execute: "custom/exec", assess: "custom/assess" },
        verify: { baseline: ["bun test"], after_each: ["bun run typecheck"] },
        max_assess_cycles: 5,
        playwright: { enabled: true, base_url: "http://localhost:4000" },
      }),
    );
    const config = loadPilotConfig(dir);
    expect(config.models.scope).toBe("custom/model");
    expect(config.models.plan).toBe("custom/plan");
    expect(config.verify.baseline).toEqual(["bun test"]);
    expect(config.max_assess_cycles).toBe(5);
    expect(config.playwright.enabled).toBe(true);
    expect(config.playwright.base_url).toBe("http://localhost:4000");
  });

  test("merges partial config with defaults", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".glrs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".glrs", "pilot.json"),
      JSON.stringify({ models: { scope: "custom/scope" } }),
    );
    const config = loadPilotConfig(dir);
    expect(config.models.scope).toBe("custom/scope");
    // Other models fall back to defaults
    expect(config.models.plan).toBe(DEFAULT_CONFIG.models.plan);
    expect(config.models.execute).toBe(DEFAULT_CONFIG.models.execute);
  });

  test("returns defaults for invalid JSON", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".glrs"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".glrs", "pilot.json"), "not json {{{");
    const config = loadPilotConfig(dir);
    expect(config.models.scope).toBe(DEFAULT_CONFIG.models.scope);
  });

  test("detects v1 format and returns defaults", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".glrs"), { recursive: true });
    // v1 format has top-level "baseline" and "after_each"
    fs.writeFileSync(
      path.join(dir, ".glrs", "pilot.json"),
      JSON.stringify({ baseline: ["bun test"], after_each: ["bun run typecheck"] }),
    );
    const config = loadPilotConfig(dir);
    // Should return defaults, not crash
    expect(config.models.scope).toBe(DEFAULT_CONFIG.models.scope);
  });

  test("validates model identifiers are strings", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".glrs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".glrs", "pilot.json"),
      JSON.stringify({ models: { scope: 42, plan: null } }),
    );
    const config = loadPilotConfig(dir);
    // Non-string values fall back to defaults
    expect(config.models.scope).toBe(DEFAULT_CONFIG.models.scope);
    expect(config.models.plan).toBe(DEFAULT_CONFIG.models.plan);
  });
});

describe("pilot config — writePilotConfig", () => {
  test("writes default config when none exists", () => {
    const dir = makeTmpDir();
    writePilotConfig(dir, DEFAULT_CONFIG);
    const written = JSON.parse(fs.readFileSync(path.join(dir, ".glrs", "pilot.json"), "utf8"));
    expect(written.models.scope).toBe(DEFAULT_CONFIG.models.scope);
    expect(written.max_assess_cycles).toBe(DEFAULT_CONFIG.max_assess_cycles);
  });

  test("preserves existing values as defaults (round-trip)", () => {
    const dir = makeTmpDir();
    const custom = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, scope: "my/custom-model" },
      max_assess_cycles: 7,
    };
    writePilotConfig(dir, custom);
    const loaded = loadPilotConfig(dir);
    expect(loaded.models.scope).toBe("my/custom-model");
    expect(loaded.max_assess_cycles).toBe(7);
  });

  test("creates .glrs/ directory if missing", () => {
    const dir = makeTmpDir();
    expect(fs.existsSync(path.join(dir, ".glrs"))).toBe(false);
    writePilotConfig(dir, DEFAULT_CONFIG);
    expect(fs.existsSync(path.join(dir, ".glrs", "pilot.json"))).toBe(true);
  });
});
