/**
 * Regression tests: the installer registers the TUI sidebar the way
 * opencode ≥1.16 expects.
 *
 * The background-jobs sidebar ships as the harness's `./tui` export. On
 * opencode ≥1.16 the TUI target registers via `tui.json` (sibling of
 * opencode.json) listing the BASE package name — verified against what
 * `opencode plugin <pkg>` itself writes ("Detected server + tui targets").
 *
 * The installer previously wrote a `<pkg>/tui` SUBPATH entry into the
 * opencode.json `plugin` array. That spec is invalid on opencode ≥1.16 — the
 * loader parses it as a package dir and errors at startup ("Could not read
 * package.json … failed to install plugin") and the sidebar never loads.
 * These tests pin both halves of the fix: tui.json registration, and
 * migration that strips the legacy entries.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { install, ensureTuiPluginRegistered } from "../src/cli/install.ts";

const LEGACY_TUI_ENTRY = "@glrs-dev/harness-plugin-opencode/tui";
const SERVER = "@glrs-dev/harness-plugin-opencode";

function tmpConfig(contents: unknown): { dir: string; configPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tui-"));
  const configPath = path.join(dir, "opencode", "opencode.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(contents, null, 2) + "\n");
  return { dir, configPath };
}

function readPlugins(configPath: string): unknown[] {
  return JSON.parse(fs.readFileSync(configPath, "utf8")).plugin;
}

function readTuiPlugins(configPath: string): unknown[] | null {
  const tuiPath = path.join(path.dirname(configPath), "tui.json");
  if (!fs.existsSync(tuiPath)) return null;
  return JSON.parse(fs.readFileSync(tuiPath, "utf8")).plugin ?? [];
}

describe("ensureTuiPluginRegistered", () => {
  it("registers the base package in tui.json when only the server entry exists", () => {
    const { dir, configPath } = tmpConfig({
      plugin: [[SERVER, { models: { deep: ["x/y"] } }]],
    });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(true);
      expect(readTuiPlugins(configPath)).toContain(SERVER);
      // The plugin array must NOT gain a subpath entry.
      expect(readPlugins(configPath)).not.toContain(LEGACY_TUI_ENTRY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates away the legacy `…/tui` plugin-array entry (errors on opencode ≥1.16)", () => {
    const { dir, configPath } = tmpConfig({ plugin: [SERVER, LEGACY_TUI_ENTRY] });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(true);
      expect(readPlugins(configPath)).not.toContain(LEGACY_TUI_ENTRY);
      expect(readPlugins(configPath)).toContain(SERVER);
      expect(readTuiPlugins(configPath)).toContain(SERVER);
      // Migration writes a backup of opencode.json before stripping.
      expect(res.bakPath).toBeDefined();
      expect(fs.existsSync(res.bakPath!)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates a hand-pinned `…@version/tui` entry too", () => {
    const pinned = `${SERVER}@3.14.1/tui`;
    const { dir, configPath } = tmpConfig({ plugin: [SERVER, pinned] });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(true);
      expect(readPlugins(configPath)).not.toContain(pinned);
      expect(readTuiPlugins(configPath)).toContain(SERVER);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent — no change when tui.json already lists the package and no legacy entries remain", () => {
    const { dir, configPath } = tmpConfig({ plugin: [SERVER] });
    const tuiPath = path.join(path.dirname(configPath), "tui.json");
    fs.writeFileSync(tuiPath, JSON.stringify({ plugin: [SERVER] }) + "\n");
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(false);
      expect(readTuiPlugins(configPath)!.filter((p) => p === SERVER).length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves unrelated tui.json plugins when registering", () => {
    const { dir, configPath } = tmpConfig({ plugin: [SERVER] });
    const tuiPath = path.join(path.dirname(configPath), "tui.json");
    fs.writeFileSync(tuiPath, JSON.stringify({ plugin: ["some-other-tui-plugin"] }) + "\n");
    try {
      ensureTuiPluginRegistered(configPath, { dryRun: false });
      const plugins = readTuiPlugins(configPath)!;
      expect(plugins).toContain("some-other-tui-plugin");
      expect(plugins).toContain(SERVER);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers tui.json even when opencode.json is absent (fresh install ordering)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tui-"));
    const configPath = path.join(dir, "opencode", "opencode.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(true);
      expect(readTuiPlugins(configPath)).toContain(SERVER);
      expect(fs.existsSync(configPath)).toBe(false); // opencode.json untouched
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run reports the change without writing", () => {
    const { dir, configPath } = tmpConfig({ plugin: [SERVER, LEGACY_TUI_ENTRY] });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: true });
      expect(res.changed).toBe(true);
      expect(readPlugins(configPath)).toContain(LEGACY_TUI_ENTRY); // not stripped
      expect(readTuiPlugins(configPath)).toBeNull(); // not written
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("install() registers the sidebar on the already-configured path", () => {
  it("writes tui.json even when nothing else needs configuring (the upgrade case)", async () => {
    // Fully-configured config: server tuple with models + both optional MCPs on,
    // so a non-interactive install hits the early "Ready" return before the
    // merge. The tui.json registration must still happen.
    const { dir, configPath } = tmpConfig({
      $schema: "https://opencode.ai/config.json",
      plugin: [[SERVER, { models: { deep: ["anthropic/claude-opus-4-7"] } }]],
      mcp: { playwright: { enabled: true }, linear: { enabled: true } },
    });

    const prevXdg = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = dir;
    const origLog = console.log;
    console.log = () => {};
    try {
      await install({ nonInteractive: true });
    } finally {
      console.log = origLog;
      if (prevXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = prevXdg;
    }

    expect(readTuiPlugins(configPath)).toContain(SERVER);
    expect(readPlugins(configPath)).not.toContain(LEGACY_TUI_ENTRY);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
