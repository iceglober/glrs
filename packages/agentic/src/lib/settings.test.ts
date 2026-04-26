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

  test("includes state.auto-open setting", () => {
    const help = settingsHelp();
    const stateOpen = help.find(h => h.key === "state.auto-open");
    expect(stateOpen).toBeDefined();
    expect(stateOpen!.default).toBe("true");
  });

  test("state.auto-open has default value", () => {
    expect(getSetting("state.auto-open")).toBe("true");
  });

  test("includes skills.auto-update setting", () => {
    const help = settingsHelp();
    const skillsUpdate = help.find(h => h.key === "skills.auto-update");
    expect(skillsUpdate).toBeDefined();
    expect(skillsUpdate!.default).toBe("true");
  });
});

describe("skills.auto-update", () => {
  test("defaults to true", () => {
    expect(getSetting("skills.auto-update")).toBe("true");
  });

  test("can be set to false", () => {
    setSetting("skills.auto-update", "false");
    expect(getSetting("skills.auto-update")).toBe("false");
  });

  test("unset reverts to default true", () => {
    setSetting("skills.auto-update", "false");
    unsetSetting("skills.auto-update");
    expect(getSetting("skills.auto-update")).toBe("true");
  });

  test("listSettings shows skills.auto-update", () => {
    const list = listSettings();
    const entry = list.find(s => s.key === "skills.auto-update");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe("true");
    expect(entry!.source).toBe("default");
  });
});

describe("plan.first-run-seen", () => {
  test("defaults to false", () => {
    expect(getSetting("plan.first-run-seen")).toBe("false");
  });

  test("can be set to true", () => {
    setSetting("plan.first-run-seen", "true");
    expect(getSetting("plan.first-run-seen")).toBe("true");
  });

  test("unset reverts to default false", () => {
    setSetting("plan.first-run-seen", "true");
    unsetSetting("plan.first-run-seen");
    expect(getSetting("plan.first-run-seen")).toBe("false");
  });

  test("listSettings includes plan.first-run-seen", () => {
    const list = listSettings();
    const entry = list.find(s => s.key === "plan.first-run-seen");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe("false");
    expect(entry!.source).toBe("default");
  });

  test("settingsHelp includes plan.first-run-seen", () => {
    const help = settingsHelp();
    const entry = help.find(h => h.key === "plan.first-run-seen");
    expect(entry).toBeDefined();
    expect(entry!.description).toBeTruthy();
  });

  test("setting empty string persists without crash", () => {
    setSetting("plan.first-run-seen", "");
    expect(getSetting("plan.first-run-seen")).toBe("");
  });
});
