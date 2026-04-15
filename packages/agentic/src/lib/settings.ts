import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".glorious", "settings.json");

let _testPath: string | null = null;

/** Override the settings file path (for testing). */
export function setSettingsPath(p: string | null): void {
  _testPath = p;
}

function settingsPath(): string {
  return _testPath ?? DEFAULT_SETTINGS_PATH;
}

/** Known settings with their defaults. */
const DEFAULTS: Record<string, string> = {
  "plan.auto-open": "true",
  "plan.first-run-seen": "false",
  "skills.auto-update": "true",
  "state.auto-open": "true",
};

function load(): Record<string, string> {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function save(data: Record<string, string>): void {
  const p = settingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

/** Get a setting value. Returns the default if not explicitly set. */
export function getSetting(key: string): string | undefined {
  const data = load();
  return data[key] ?? DEFAULTS[key];
}

/** Set a setting value. */
export function setSetting(key: string, value: string): void {
  const data = load();
  data[key] = value;
  save(data);
}

/** Delete a setting, reverting to default. */
export function unsetSetting(key: string): void {
  const data = load();
  delete data[key];
  save(data);
}

/** List all settings (explicit overrides + defaults). */
export function listSettings(): Array<{ key: string; value: string; source: "user" | "default" }> {
  const data = load();
  const seen = new Set<string>();
  const result: Array<{ key: string; value: string; source: "user" | "default" }> = [];

  for (const [key, value] of Object.entries(data)) {
    seen.add(key);
    result.push({ key, value, source: "user" });
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!seen.has(key)) {
      result.push({ key, value, source: "default" });
    }
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

/** Get all known setting keys with descriptions. */
export function settingsHelp(): Array<{ key: string; default: string; description: string }> {
  return [
    { key: "plan.auto-open", default: "true", description: "Automatically open browser when running plan review" },
    { key: "plan.first-run-seen", default: "false", description: "Whether the first-run auto-open info dialog has been shown" },
    { key: "skills.auto-update", default: "true", description: "Automatically sync skills when CLI version changes" },
    { key: "state.auto-open", default: "true", description: "Automatically open browser when running state web" },
  ];
}
