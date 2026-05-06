/**
 * Pilot v2 configuration.
 *
 * Config lives at .glrs/pilot.json in the user's repo.
 * Written by `pilot configure` (interactive) or manually.
 *
 * Schema:
 * {
 *   "models": {
 *     "scope":   "anthropic/claude-sonnet-4-6",
 *     "plan":    "anthropic/claude-sonnet-4-6",
 *     "execute": "anthropic/claude-sonnet-4-6",
 *     "assess":  "anthropic/claude-sonnet-4-6"
 *   },
 *   "verify": {
 *     "baseline":   ["bun test", "bun run typecheck"],
 *     "after_each": ["bun run typecheck"]
 *   },
 *   "max_assess_cycles": 3,
 *   "playwright": {
 *     "enabled":  false,
 *     "base_url": "http://localhost:3000"
 *   }
 * }
 *
 * All fields are optional — defaults are applied when missing.
 * Old-format detection: if the file has a "baseline" or "after_each" key
 * at the top level (v1 format), we warn and ignore it.
 */

import * as fs from "node:fs";
import { getPilotConfigPath } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PhaseModels = {
  scope: string;
  plan: string;
  execute: string;
  assess: string;
};

export type VerifyConfig = {
  baseline: string[];
  after_each: string[];
};

export type PlaywrightConfig = {
  enabled: boolean;
  base_url: string;
};

export type PilotConfig = {
  models: PhaseModels;
  verify: VerifyConfig;
  max_assess_cycles: number;
  playwright: PlaywrightConfig;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export const DEFAULT_CONFIG: PilotConfig = {
  models: {
    scope: DEFAULT_MODEL,
    plan: DEFAULT_MODEL,
    execute: DEFAULT_MODEL,
    assess: DEFAULT_MODEL,
  },
  verify: {
    baseline: [],
    after_each: [],
  },
  max_assess_cycles: 3,
  playwright: {
    enabled: false,
    base_url: "http://localhost:3000",
  },
};

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load .glrs/pilot.json from the given working directory.
 * Returns DEFAULT_CONFIG if the file doesn't exist.
 * Warns and returns DEFAULT_CONFIG if the file is in the old v1 format.
 * Merges partial configs with defaults (deep merge for nested objects).
 */
export function loadPilotConfig(cwd: string): PilotConfig {
  const configPath = getPilotConfigPath(cwd);

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    process.stderr.write(
      `[pilot] Warning: .glrs/pilot.json has invalid JSON — using defaults\n`,
    );
    return { ...DEFAULT_CONFIG };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIG };
  }

  const obj = raw as Record<string, unknown>;

  // Detect v1 format (top-level "baseline" or "after_each" keys)
  if ("baseline" in obj || "after_each" in obj) {
    process.stderr.write(
      `[pilot] Warning: .glrs/pilot.json appears to be in the old pilot v1 format.\n` +
      `  Run \`pilot configure\` to set up the new v2 configuration.\n` +
      `  Using defaults for now.\n`,
    );
    return { ...DEFAULT_CONFIG };
  }

  // Deep merge with defaults
  const models = mergeModels(obj["models"]);
  const verify = mergeVerify(obj["verify"]);
  const playwright = mergePlaywright(obj["playwright"]);
  const max_assess_cycles =
    typeof obj["max_assess_cycles"] === "number" && obj["max_assess_cycles"] > 0
      ? obj["max_assess_cycles"]
      : DEFAULT_CONFIG.max_assess_cycles;

  return { models, verify, max_assess_cycles, playwright };
}

function mergeModels(raw: unknown): PhaseModels {
  const d = DEFAULT_CONFIG.models;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const obj = raw as Record<string, unknown>;
  return {
    scope:   typeof obj["scope"]   === "string" ? obj["scope"]   : d.scope,
    plan:    typeof obj["plan"]    === "string" ? obj["plan"]    : d.plan,
    execute: typeof obj["execute"] === "string" ? obj["execute"] : d.execute,
    assess:  typeof obj["assess"]  === "string" ? obj["assess"]  : d.assess,
  };
}

function mergeVerify(raw: unknown): VerifyConfig {
  const d = DEFAULT_CONFIG.verify;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const obj = raw as Record<string, unknown>;
  return {
    baseline:   Array.isArray(obj["baseline"])   ? obj["baseline"].filter((x): x is string => typeof x === "string")   : d.baseline,
    after_each: Array.isArray(obj["after_each"]) ? obj["after_each"].filter((x): x is string => typeof x === "string") : d.after_each,
  };
}

function mergePlaywright(raw: unknown): PlaywrightConfig {
  const d = DEFAULT_CONFIG.playwright;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const obj = raw as Record<string, unknown>;
  return {
    enabled:  typeof obj["enabled"]  === "boolean" ? obj["enabled"]  : d.enabled,
    base_url: typeof obj["base_url"] === "string"  ? obj["base_url"] : d.base_url,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a PilotConfig to .glrs/pilot.json.
 * Creates .glrs/ if it doesn't exist.
 */
export function writePilotConfig(cwd: string, config: PilotConfig): void {
  const configPath = getPilotConfigPath(cwd);
  const dir = configPath.slice(0, configPath.lastIndexOf("/"));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
