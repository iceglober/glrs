import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getSetting, setSetting, unsetSetting, listSettings, settingsHelp, setSettingsPath } from "./settings.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-settings-test-" + process.pid);
const TEST_SETTINGS = path.join(TEST_DIR, "settings.json");

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  setSettingsPath(TEST_SETTINGS);
});

afterEach(() => {
  setSettingsPath(null);
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe("getSetting", () => {
  test("returns default for known key", () => {
    expect(getSetting("plan.auto-open")).toBe("true");
  });

  test("returns undefined for unknown key", () => {
    expect(getSetting("nonexistent.key")).toBeUndefined();
  });
});

describe("setSetting / getSetting roundtrip", () => {
  test("set and get a value", () => {
    setSetting("plan.auto-open", "false");
    expect(getSetting("plan.auto-open")).toBe("false");
  });

  test("set custom key", () => {
    setSetting("custom.key", "hello");
    expect(getSetting("custom.key")).toBe("hello");
  });
});

describe("unsetSetting", () => {
  test("reverts to default", () => {
    setSetting("plan.auto-open", "false");
    unsetSetting("plan.auto-open");
    expect(getSetting("plan.auto-open")).toBe("true");
  });

  test("no-op for unset key", () => {
    expect(() => unsetSetting("nonexistent")).not.toThrow();
  });
});

describe("listSettings", () => {
  test("includes defaults when no overrides", () => {
    const list = listSettings();
    const planOpen = list.find(s => s.key === "plan.auto-open");
    expect(planOpen).toBeDefined();
    expect(planOpen!.value).toBe("true");
    expect(planOpen!.source).toBe("default");
  });

  test("shows user overrides", () => {
    setSetting("plan.auto-open", "false");
    const list = listSettings();
    const planOpen = list.find(s => s.key === "plan.auto-open");
    expect(planOpen!.value).toBe("false");
    expect(planOpen!.source).toBe("user");
  });
});

describe("settingsHelp", () => {
  test("returns known settings with descriptions", () => {
    const help = settingsHelp();
    expect(help.length).toBeGreaterThan(0);
    expect(help[0].key).toBe("plan.auto-open");
    expect(help[0].description).toBeTruthy();
  });
});
