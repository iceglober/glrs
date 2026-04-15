import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  generateFormatterHook,
  generateSafetyHook,
  mergeHookConfigs,
  detectFormatter,
} from "./hooks.js";

describe("generateFormatterHook", () => {
  test("produces PostToolUse config with Write|Edit matcher", () => {
    const config = generateFormatterHook("npx prettier --write");
    expect(config.hooks.PostToolUse).toBeDefined();
    expect(config.hooks.PostToolUse![0].matcher).toBe("Write|Edit");
    expect(config.hooks.PostToolUse![0].hooks[0].command).toContain("prettier");
  });

  test("custom formatter command is used verbatim", () => {
    const config = generateFormatterHook("npx @biomejs/biome check --write");
    expect(config.hooks.PostToolUse![0].hooks[0].command).toContain("biome check --write");
  });

  test("output is valid JSON", () => {
    const config = generateFormatterHook("prettier");
    expect(() => JSON.stringify(config)).not.toThrow();
  });
});

describe("generateSafetyHook", () => {
  test("produces PreToolUse config with Bash matcher", () => {
    const config = generateSafetyHook();
    expect(config.hooks.PreToolUse).toBeDefined();
    expect(config.hooks.PreToolUse![0].matcher).toBe("Bash");
  });

  test("command script checks for rm -rf", () => {
    const config = generateSafetyHook();
    const cmd = config.hooks.PreToolUse![0].hooks[0].command;
    expect(cmd).toContain("rm -rf");
  });

  test("command script checks for git push --force", () => {
    const config = generateSafetyHook();
    const cmd = config.hooks.PreToolUse![0].hooks[0].command;
    expect(cmd).toContain("git push --force");
  });

  test("command script checks for git reset --hard", () => {
    const config = generateSafetyHook();
    const cmd = config.hooks.PreToolUse![0].hooks[0].command;
    expect(cmd).toContain("git reset --hard");
  });

  test("output is valid JSON", () => {
    const config = generateSafetyHook();
    expect(() => JSON.stringify(config)).not.toThrow();
  });
});

describe("mergeHookConfigs", () => {
  test("merges PreToolUse and PostToolUse from separate configs", () => {
    const a = generateFormatterHook("prettier");
    const b = generateSafetyHook();
    const merged = mergeHookConfigs(a, b);
    expect(merged.hooks.PostToolUse).toBeDefined();
    expect(merged.hooks.PreToolUse).toBeDefined();
    expect(merged.hooks.PostToolUse!.length).toBe(1);
    expect(merged.hooks.PreToolUse!.length).toBe(1);
  });

  test("concatenates entries for the same lifecycle event", () => {
    const a = generateSafetyHook();
    const b = generateSafetyHook();
    const merged = mergeHookConfigs(a, b);
    expect(merged.hooks.PreToolUse!.length).toBe(2);
  });

  test("handles empty config", () => {
    const a = generateFormatterHook("prettier");
    const empty = { hooks: {} };
    const merged = mergeHookConfigs(a, empty);
    expect(merged.hooks.PostToolUse!.length).toBe(1);
    expect(merged.hooks.PreToolUse).toBeUndefined();
  });
});

describe("detectFormatter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-hooks-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  test("detects prettier from .prettierrc", () => {
    fs.writeFileSync(path.join(tmpDir, ".prettierrc"), "{}");
    expect(detectFormatter(tmpDir)).toContain("prettier");
  });

  test("detects biome from biome.json", () => {
    fs.writeFileSync(path.join(tmpDir, "biome.json"), "{}");
    expect(detectFormatter(tmpDir)).toContain("biome");
  });

  test("returns null when no formatter config found", () => {
    expect(detectFormatter(tmpDir)).toBeNull();
  });

  test("prettier takes precedence over biome when both exist", () => {
    fs.writeFileSync(path.join(tmpDir, ".prettierrc"), "{}");
    fs.writeFileSync(path.join(tmpDir, "biome.json"), "{}");
    expect(detectFormatter(tmpDir)).toContain("prettier");
  });
});
