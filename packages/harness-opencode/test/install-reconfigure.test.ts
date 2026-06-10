/**
 * Tests for the reconfigure models/MCPs imperative overwrite path.
 *
 * These tests verify that when a user opts into reconfiguring models or MCPs,
 * the installer actually writes the new selections to opencode.json,
 * bypassing the non-destructive merge policy.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  writePluginOption,
  writeMcpToggles,
  writePluginToggles,
} from "../src/cli/install.ts";

const PLUGIN_NAME = "@glrs-dev/harness-plugin-opencode";

let tmpDir: string;
let configPath: string;
let prevXdg: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "install-reconfigure-test-"));
  configPath = path.join(tmpDir, "opencode.json");
  prevXdg = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = tmpDir;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = prevXdg;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: unknown): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(content, null, 2) + "\n");
}

function readConfig(): unknown {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

describe("reconfigure models", () => {
  it("reconfigure models overwrites existing tuple options.models", () => {
    const initialModels = {
      deep: ["anthropic/claude-opus-4-7"],
      mid: ["anthropic/claude-sonnet-4-6"],
      fast: ["anthropic/claude-haiku-4-5-20251001"],
    };
    const newModels = {
      deep: ["amazon-bedrock/global.anthropic.claude-opus-4-7"],
      mid: ["amazon-bedrock/global.anthropic.claude-sonnet-4-6"],
      fast: ["amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0"],
    };

    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [[PLUGIN_NAME, { models: initialModels, customKey: "preserved" }]],
    });

    const result = writePluginOption(configPath, "models", newModels, { dryRun: false });

    expect(result.changed).toBe(true);
    expect(result.bakPath).toBeDefined();
    expect(fs.existsSync(result.bakPath!)).toBe(true);

    const config = readConfig() as any;
    expect(Array.isArray(config.plugin[0])).toBe(true);
    expect(config.plugin[0][1].models).toEqual(newModels);
    expect(config.plugin[0][1].customKey).toBe("preserved");
  });

  it("reconfigure models upgrades plain-string plugin entry to tuple", () => {
    const newModels = {
      deep: ["amazon-bedrock/global.anthropic.claude-opus-4-7"],
      mid: ["amazon-bedrock/global.anthropic.claude-sonnet-4-6"],
      fast: ["amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0"],
    };

    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
    });

    const result = writePluginOption(configPath, "models", newModels, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    expect(Array.isArray(config.plugin[0])).toBe(true);
    expect(config.plugin[0][0]).toBe(PLUGIN_NAME);
    expect(config.plugin[0][1].models).toEqual(newModels);
  });

  it("reconfigure models handles pinned plugin version", () => {
    const newModels = {
      deep: ["amazon-bedrock/global.anthropic.claude-opus-4-7"],
      mid: ["amazon-bedrock/global.anthropic.claude-sonnet-4-6"],
      fast: ["amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0"],
    };

    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [[`${PLUGIN_NAME}@0.8.2`, { models: { deep: ["old"] } }]],
    });

    const result = writePluginOption(configPath, "models", newModels, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    expect(config.plugin[0][0]).toBe(`${PLUGIN_NAME}@0.8.2`);
    expect(config.plugin[0][1].models).toEqual(newModels);
  });

  it("reconfigure models returns changed=false when value is unchanged", () => {
    const sameModels = {
      deep: ["anthropic/claude-opus-4-7"],
      mid: ["anthropic/claude-sonnet-4-6"],
      fast: ["anthropic/claude-haiku-4-5-20251001"],
    };

    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [[PLUGIN_NAME, { models: sameModels }]],
    });

    const result = writePluginOption(configPath, "models", sameModels, { dryRun: false });

    expect(result.changed).toBe(false);
    expect(result.bakPath).toBeUndefined();
  });
});

describe("reconfigure council", () => {
  it("writes the council block alongside existing options", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [[PLUGIN_NAME, { models: { deep: ["anthropic/claude-opus-4-7"] } }]],
    });

    const council = {
      members: ["anthropic/claude-opus-4-7", "openai/gpt-5.1"],
      chairman: "anthropic/claude-opus-4-7",
    };
    const result = writePluginOption(configPath, "council", council, { dryRun: false });

    expect(result.changed).toBe(true);
    const config = readConfig() as any;
    expect(config.plugin[0][1].council).toEqual(council);
    expect(config.plugin[0][1].models).toEqual({ deep: ["anthropic/claude-opus-4-7"] });
  });

  it("removes the council block when value is undefined", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [[PLUGIN_NAME, { council: { members: ["a/b", "c/d"] }, models: {} }]],
    });

    const result = writePluginOption(configPath, "council", undefined, { dryRun: false });

    expect(result.changed).toBe(true);
    const config = readConfig() as any;
    expect("council" in config.plugin[0][1]).toBe(false);
    expect(config.plugin[0][1].models).toEqual({});
  });
});

describe("reconfigure MCPs", () => {
  it("reconfigure MCPs applies new selections and preserves user-authored MCPs", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
      mcp: {
        playwright: { enabled: true },
        linear: { enabled: true },
        userCustom: { enabled: true, customField: "preserved" },
      },
    });

    // Reconfigure: disable linear, keep playwright
    const newEnabled = new Set(["playwright"]);
    const result = writeMcpToggles(configPath, newEnabled, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    // playwright should still be enabled
    expect(config.mcp.playwright).toEqual({ enabled: true });
    // linear should be removed (not just disabled)
    expect(config.mcp.linear).toBeUndefined();
    // userCustom should be preserved
    expect(config.mcp.userCustom).toEqual({ enabled: true, customField: "preserved" });
  });

  it("reconfigure MCPs adds new toggles", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
      mcp: {},
    });

    const newEnabled = new Set(["playwright", "linear"]);
    const result = writeMcpToggles(configPath, newEnabled, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    expect(config.mcp.playwright).toEqual({ enabled: true });
    expect(config.mcp.linear).toEqual({ enabled: true });
  });

  it("reconfigure MCPs removes mcp key when all toggles disabled and no user MCPs", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
      mcp: {
        playwright: { enabled: true },
      },
    });

    const newEnabled = new Set<string>();
    const result = writeMcpToggles(configPath, newEnabled, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    expect(config.mcp).toBeUndefined();
  });

  it("reconfigure MCPs returns changed=false when selection matches existing", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
      mcp: {
        playwright: { enabled: true },
      },
    });

    const sameEnabled = new Set(["playwright"]);
    const result = writeMcpToggles(configPath, sameEnabled, { dryRun: false });

    expect(result.changed).toBe(false);
  });
});

describe("reconfigure backup", () => {
  it("reconfigure writes a .bak sibling before mutating", () => {
    const initialContent = {
      $schema: "https://opencode.ai/config.json",
      plugin: [[PLUGIN_NAME, { models: { deep: ["old"] } }]],
    };

    writeConfig(initialContent);
    const originalBytes = fs.readFileSync(configPath);

    const newModels = {
      deep: ["amazon-bedrock/global.anthropic.claude-opus-4-7"],
      mid: ["amazon-bedrock/global.anthropic.claude-sonnet-4-6"],
      fast: ["amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0"],
    };

    const result = writePluginOption(configPath, "models", newModels, { dryRun: false });

    expect(result.changed).toBe(true);
    expect(result.bakPath).toBeDefined();
    expect(fs.existsSync(result.bakPath!)).toBe(true);

    // Backup should contain original bytes verbatim
    const backupBytes = fs.readFileSync(result.bakPath!);
    expect(backupBytes.equals(originalBytes)).toBe(true);

    // Config should have new values
    const config = readConfig() as any;
    expect(config.plugin[0][1].models).toEqual(newModels);
  });
});

describe("dry-run reconfigure", () => {
  it("dry-run reconfigure does not touch the file", () => {
    const initialContent = {
      $schema: "https://opencode.ai/config.json",
      plugin: [[PLUGIN_NAME, { models: { deep: ["old"] } }]],
    };

    writeConfig(initialContent);
    const originalBytes = fs.readFileSync(configPath);

    const newModels = {
      deep: ["amazon-bedrock/global.anthropic.claude-opus-4-7"],
      mid: ["amazon-bedrock/global.anthropic.claude-sonnet-4-6"],
      fast: ["amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0"],
    };

    const result = writePluginOption(configPath, "models", newModels, { dryRun: true });

    expect(result.changed).toBe(true);
    expect(result.bakPath).toBeUndefined();

    // File should be unchanged
    const currentBytes = fs.readFileSync(configPath);
    expect(currentBytes.equals(originalBytes)).toBe(true);

    // No backup should exist
    const files = fs.readdirSync(tmpDir);
    const backups = files.filter((f) => f.includes(".bak."));
    expect(backups.length).toBe(0);
  });

  it("dry-run MCP reconfigure does not touch the file", () => {
    const initialContent = {
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
      mcp: { playwright: { enabled: true } },
    };

    writeConfig(initialContent);
    const originalBytes = fs.readFileSync(configPath);

    const newEnabled = new Set<string>();
    const result = writeMcpToggles(configPath, newEnabled, { dryRun: true });

    expect(result.changed).toBe(true);

    // File should be unchanged
    const currentBytes = fs.readFileSync(configPath);
    expect(currentBytes.equals(originalBytes)).toBe(true);
  });
});

describe("plugin toggles", () => {
  it("plugin toggle adds opencode-snip to plugin array when enabled", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
    });

    const enabled = new Set(["opencode-snip"]);
    const result = writePluginToggles(configPath, enabled, { dryRun: false });

    expect(result.changed).toBe(true);
    expect(result.bakPath).toBeDefined();
    expect(fs.existsSync(result.bakPath!)).toBe(true);

    const config = readConfig() as any;
    expect(config.plugin).toContain("opencode-snip");
    // Our own plugin entry must still be present
    expect(
      config.plugin.some(
        (p: any) => p === PLUGIN_NAME || (Array.isArray(p) && p[0] === PLUGIN_NAME),
      ),
    ).toBe(true);
  });

  it("plugin toggle does not add opencode-snip when disabled", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
    });

    const enabled = new Set<string>(); // empty — toggle OFF
    const result = writePluginToggles(configPath, enabled, { dryRun: false });

    // No change needed — opencode-snip was never there
    expect(result.changed).toBe(false);

    const config = readConfig() as any;
    expect(config.plugin).not.toContain("opencode-snip");
  });

  it("plugin toggle removes opencode-snip on reconfigure OFF", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME, "opencode-snip", "user-other-plugin"],
    });

    const enabled = new Set<string>(); // toggle OFF
    const result = writePluginToggles(configPath, enabled, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    expect(config.plugin).not.toContain("opencode-snip");
    // Other entries must be preserved
    expect(
      config.plugin.some(
        (p: any) => p === PLUGIN_NAME || (Array.isArray(p) && p[0] === PLUGIN_NAME),
      ),
    ).toBe(true);
    expect(config.plugin).toContain("user-other-plugin");
  });

  it("plugin toggle adds opencode-snip on reconfigure ON", () => {
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME, "user-other-plugin"],
    });

    const enabled = new Set(["opencode-snip"]); // toggle ON
    const result = writePluginToggles(configPath, enabled, { dryRun: false });

    expect(result.changed).toBe(true);

    const config = readConfig() as any;
    expect(config.plugin).toContain("opencode-snip");
    expect(config.plugin).toContain("user-other-plugin");
    expect(
      config.plugin.some(
        (p: any) => p === PLUGIN_NAME || (Array.isArray(p) && p[0] === PLUGIN_NAME),
      ),
    ).toBe(true);
  });

  it("plugin toggle is idempotent", () => {
    // Already present — toggling ON again should not duplicate
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME, "opencode-snip"],
    });

    const enabledOn = new Set(["opencode-snip"]);
    const resultOn = writePluginToggles(configPath, enabledOn, { dryRun: false });
    expect(resultOn.changed).toBe(false);

    const configAfterOn = readConfig() as any;
    const snipCount = configAfterOn.plugin.filter((p: any) => p === "opencode-snip").length;
    expect(snipCount).toBe(1); // no duplicate

    // Already absent — toggling OFF again should report changed=false
    writeConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [PLUGIN_NAME],
    });

    const enabledOff = new Set<string>();
    const resultOff = writePluginToggles(configPath, enabledOff, { dryRun: false });
    expect(resultOff.changed).toBe(false);
  });
});
