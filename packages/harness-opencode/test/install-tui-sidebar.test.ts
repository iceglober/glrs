/**
 * Regression test: the installer registers the TUI sidebar target.
 *
 * The background-jobs sidebar ships as the harness's `./tui` export, but
 * opencode loads each `plugin`-array entry independently — the sidebar only
 * activates when `@glrs-dev/harness-plugin-opencode/tui` is its OWN entry in the
 * array. The installer used to write only the server tuple, so the sidebar
 * never appeared from a published install (it worked only when a developer ran
 * `opencode plugin <pkg>` by hand). These tests pin the fix: every install path,
 * including the "already fully configured" early return (the upgrade case),
 * adds the sidebar entry.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { install, ensureTuiPluginRegistered } from "../src/cli/install.ts";

const TUI_ENTRY = "@glrs-dev/harness-plugin-opencode/tui";
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

describe("ensureTuiPluginRegistered", () => {
  it("appends the TUI subpath when only the server entry is present", () => {
    const { dir, configPath } = tmpConfig({
      plugin: [[SERVER, { models: { deep: ["x/y"] } }]],
    });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(true);
      expect(readPlugins(configPath)).toContain(TUI_ENTRY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent — no change when the canonical entry already exists", () => {
    const { dir, configPath } = tmpConfig({ plugin: [SERVER, TUI_ENTRY] });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(false);
      const plugins = readPlugins(configPath);
      expect(plugins.filter((p) => p === TUI_ENTRY).length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recognizes a hand-pinned `…@version/tui` entry and does not duplicate", () => {
    const pinned = `${SERVER}@3.14.1/tui`;
    const { dir, configPath } = tmpConfig({ plugin: [SERVER, pinned] });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: false });
      expect(res.changed).toBe(false);
      expect(readPlugins(configPath)).not.toContain(TUI_ENTRY);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-ops when the config file is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tui-"));
    try {
      const res = ensureTuiPluginRegistered(
        path.join(dir, "nope", "opencode.json"),
        { dryRun: false },
      );
      expect(res.changed).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run reports the change without writing", () => {
    const { dir, configPath } = tmpConfig({ plugin: [SERVER] });
    try {
      const res = ensureTuiPluginRegistered(configPath, { dryRun: true });
      expect(res.changed).toBe(true);
      expect(readPlugins(configPath)).not.toContain(TUI_ENTRY); // not written
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("install() registers the sidebar on the already-configured path", () => {
  it("adds the TUI entry even when nothing else needs configuring (the upgrade case)", async () => {
    // Fully-configured config: server tuple with models + both optional MCPs on,
    // so a non-interactive install hits the early "Ready" return before the
    // merge. The sidebar entry must still get added.
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

    expect(readPlugins(configPath)).toContain(TUI_ENTRY);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
