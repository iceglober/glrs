/**
 * `glrs-oc install-plugin` / `glrs-oc install`
 *
 * Interactive plugin installer. When run in a TTY, walks the user through:
 *   1. Plugin registration (always)
 *   2. Model provider selection (Anthropic direct, AWS Bedrock, or custom)
 *   3. MCP server toggles (playwright, linear)
 *
 * Idempotent: reads the existing config first and only prompts for keys
 * that aren't already set. Re-running shows a summary of current config
 * and skips questions whose answers are already in opencode.json.
 *
 * Non-interactive (no TTY or --non-interactive): registers the plugin
 * with defaults and skips all prompts.
 *
 * Adds configuration to `~/.config/opencode/opencode.json` via non-
 * destructive merge. Preserves all existing user keys. Writes a
 * `.bak.<epoch>-<pid>` backup before every mutation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { mergeConfig, seedConfig } from "./merge-config.js";
import { promptChoice, promptMulti } from "./plugin-check.js";
import {
  readOurPackageVersion,
  refreshPluginCache,
  inspectCachePin,
  getOpenCodeCachePackageDir,
} from "../auto-update.js";
import { fetchModelsDevProviders, suggestTiersFromModelsDev, pickBedrockTierIds, type ModelsDevProvider } from "./models-dev.js";
// (model-family detection removed — tier-based approach)

const PLUGIN_NAME = "@glrs-dev/harness-plugin-opencode";

// --- ANSI helpers ----------------------------------------------------------

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

const ok = (msg: string) => console.log(`${c.green}✓${c.reset} ${msg}`);
const info = (msg: string) => console.log(`${c.blue}•${c.reset} ${msg}`);
const warn = (msg: string) => console.log(`${c.yellow}!${c.reset} ${msg}`);

// --- Model provider presets ------------------------------------------------

export interface ModelPreset {
  label: string;
  providerId: string;
  deep: string;
  mid: string;
  fast: string;
}

/**
 * Hardcoded fallback presets — used when the Models.dev API is unreachable.
 *
 * Model IDs are in `<provider_id>/<model_id>` format, matching Models.dev's
 * registry (which is also what OpenCode's runtime validates against). The
 * Bedrock preset uses the `global.anthropic.*` CRIS route for broadest
 * availability. The Vertex preset uses `google-vertex-anthropic` (separate
 * from `google-vertex` which hosts Google's own models).
 */
export const MODEL_PRESETS: ModelPreset[] = [
  {
    label: "Anthropic API (direct)",
    providerId: "anthropic",
    deep: "anthropic/claude-opus-4-7",
    mid: "anthropic/claude-sonnet-4-6",
    fast: "anthropic/claude-haiku-4-5-20251001",
  },
  {
    label: "AWS Bedrock",
    providerId: "amazon-bedrock",
    deep: "amazon-bedrock/global.anthropic.claude-opus-4-7",
    mid: "amazon-bedrock/global.anthropic.claude-sonnet-4-6",
    fast: "amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
  },
  {
    label: "Google Vertex AI (Claude)",
    providerId: "google-vertex-anthropic",
    deep: "google-vertex-anthropic/claude-opus-4-7@default",
    mid: "google-vertex-anthropic/claude-sonnet-4-6@default",
    fast: "google-vertex-anthropic/claude-haiku-4-5@20251001",
  },
];

// --- MCP toggle definitions ------------------------------------------------

interface McpToggle {
  name: string;
  label: string;
  defaultOn: boolean;
}

const MCP_TOGGLES: McpToggle[] = [
  { name: "playwright", label: "Playwright — browser automation", defaultOn: false },
  { name: "linear", label: "Linear — issue tracker integration", defaultOn: false },
];

// --- Helpers ---------------------------------------------------------------

/**
 * Extract plugin options from the tuple form in the plugin array.
 * Supports: `["@glrs-dev/harness-plugin-opencode", { ... }]`
 * Returns the options object, or null if not found/not tuple form.
 */
function extractPluginOptions(
  config: Record<string, any> | null,
): Record<string, any> | null {
  if (!config) return null;
  const plugins = config.plugin;
  if (!Array.isArray(plugins)) return null;

  for (const entry of plugins) {
    if (
      Array.isArray(entry) &&
      entry.length >= 2 &&
      (entry[0] === PLUGIN_NAME || String(entry[0]).startsWith(`${PLUGIN_NAME}@`))
    ) {
      return entry[1] as Record<string, any>;
    }
  }
  return null;
}

/**
 * Read the plugin's version from its package.json.
 */
function readPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "package.json"),
    path.join(here, "..", "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === PLUGIN_NAME && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `Could not locate ${PLUGIN_NAME}'s package.json to read version`,
  );
}

function getOpencodeConfigPath(): string {
  const configHome =
    process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode", "opencode.json");
}

/**
 * Refresh the OpenCode plugin cache if it exists and is stale.
 *
 * The cache at ~/.cache/opencode/packages/@glrs-dev/harness-plugin-opencode@latest/
 * can get stuck with an exact pin to an old version and no node_modules/.
 * When that happens, the plugin never loads (no code to run), and the
 * in-plugin auto-update never fires. This function breaks the deadlock
 * by rewriting the cache pin to match the version we're running as.
 */
async function refreshPluginCacheIfStale(): Promise<void> {
  try {
    const cacheDir = getOpenCodeCachePackageDir();
    const pin = await inspectCachePin(cacheDir);

    if (pin.kind !== "exact") return; // no cache, non-exact, or not our package

    const ourVersion = readOurPackageVersion(import.meta.url);
    if (pin.version === ourVersion) return; // already current

    const result = await refreshPluginCache(pin.version, ourVersion);
    if (result.outcome === "refreshed") {
      ok(`Plugin cache updated: ${result.fromVersion} → ${result.toVersion}`);
    }
  } catch {
    // Best-effort — never break install over a cache issue.
  }
}

/**
 * Safely read and parse the existing opencode.json, or return null.
 */
function readExistingConfig(configPath: string): Record<string, any> | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Detect the current model provider from an existing config's plugin
 * options (tuple form) or legacy `harness.models` block.
 * Returns a human-readable label.
 */
function detectModelProvider(existing: Record<string, any> | null): string | null {
  // Check tuple form first: ["@glrs-dev/harness-plugin-opencode", { models: {...} }]
  const opts = extractPluginOptions(existing);
  const models = opts?.models ?? existing?.harness?.models;
  if (!models) return null;

  const deep = Array.isArray(models.deep) ? models.deep[0] : models.deep;
  if (typeof deep !== "string") return null;

  for (const preset of MODEL_PRESETS) {
    if (deep === preset.deep) return preset.label;
  }
  return `custom (${deep})`;
}

/**
 * Detect which optional MCPs are already configured in the existing config.
 */
function detectEnabledMcps(existing: Record<string, any> | null): Set<string> {
  const enabled = new Set<string>();
  const mcp = existing?.mcp;
  if (!mcp || typeof mcp !== "object") return enabled;

  for (const toggle of MCP_TOGGLES) {
    if (mcp[toggle.name]?.enabled === true) {
      enabled.add(toggle.name);
    }
  }
  return enabled;
}

// --- Install logic ---------------------------------------------------------

/**
 * Migrate the legacy `harness` top-level key in opencode.json into the
 * plugin options tuple. Reads the file, checks for a `harness` key,
 * moves its contents into the plugin entry's options, and removes the
 * top-level key. Writes a backup before mutating.
 *
 * No-op if:
 *   - The file doesn't exist or isn't valid JSON
 *   - There is no `harness` key
 *   - The plugin isn't in the plugin array
 */
function migrateHarnessKeyToPluginOptions(configPath: string): void {
  try {
    if (!fs.existsSync(configPath)) return;
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    if (!config.harness || typeof config.harness !== "object") return;

    const plugins: any[] = Array.isArray(config.plugin) ? config.plugin : [];
    const pluginIdx = plugins.findIndex((entry: any) => {
      const name = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : null;
      return name === PLUGIN_NAME || String(name ?? "").startsWith(`${PLUGIN_NAME}@`);
    });
    if (pluginIdx < 0) return;

    // Extract the current plugin entry and merge harness config into options.
    const current = plugins[pluginIdx];
    const existingName = typeof current === "string"
      ? current
      : Array.isArray(current) ? current[0] : PLUGIN_NAME;
    const existingOpts = Array.isArray(current) && current.length >= 2
      ? (current[1] as Record<string, unknown>)
      : {};

    // Merge: harness.models → options.models (existing options win on conflict)
    const merged: Record<string, unknown> = { ...config.harness, ...existingOpts };
    plugins[pluginIdx] = [existingName, merged];

    // Remove the legacy key.
    delete config.harness;

    // Write backup + new config.
    const bakPath = `${configPath}.bak.${Date.now()}-${process.pid}`;
    fs.copyFileSync(configPath, bakPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    ok("Migrated legacy `harness` config into plugin options");
    info(`Backup: ${bakPath}`);
  } catch {
    // Migration is best-effort. If it fails, the user can fix manually.
  }
}

/**
 * Deep equality check for JSON-serializable values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

/**
 * Write a specific sub-key to the plugin options tuple in opencode.json.
 * Handles both plain-string and tuple-form plugin entries, upgrades plain-string
 * to tuple as needed, and preserves unrelated options.
 *
 * Returns { changed: false } when the new value is deep-equal to existing (no-op).
 */
export function writePluginOption(
  configPath: string,
  subKey: "models" | "mcp",
  value: unknown,
  opts: { dryRun: boolean },
): { changed: boolean; bakPath?: string } {
  try {
    if (!fs.existsSync(configPath)) {
      return { changed: false };
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);

    if (!Array.isArray(config.plugin)) {
      return { changed: false };
    }

    // Find plugin entry index
    const pluginIdx = config.plugin.findIndex((entry: any) => {
      const name = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : null;
      return name === PLUGIN_NAME || String(name ?? "").startsWith(`${PLUGIN_NAME}@`);
    });

    if (pluginIdx < 0) {
      return { changed: false };
    }

    const current = config.plugin[pluginIdx];
    const existingName = typeof current === "string"
      ? current
      : Array.isArray(current) ? current[0] : PLUGIN_NAME;
    const existingOpts = Array.isArray(current) && current.length >= 2
      ? (current[1] as Record<string, unknown>)
      : {};

    // Check if value is unchanged
    if (deepEqual(existingOpts[subKey], value)) {
      return { changed: false };
    }

    // Prepare new options with the subKey set
    const newOpts: Record<string, unknown> = { ...existingOpts, [subKey]: value };

    if (opts.dryRun) {
      info(`[dry-run] Would reconfigure ${subKey} in plugin options`);
      return { changed: true };
    }

    // Write backup
    const bakPath = `${configPath}.bak.${Date.now()}-${process.pid}`;
    fs.copyFileSync(configPath, bakPath);

    // Update plugin entry to tuple form with new options
    config.plugin[pluginIdx] = [existingName, newOpts];

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    ok(`Reconfigured ${subKey}`);
    info(`Backup: ${bakPath}`);

    return { changed: true, bakPath };
  } catch {
    // Best-effort: if anything fails, return no-change
    return { changed: false };
  }
}

/**
 * Write MCP toggle selections to the top-level mcp object in opencode.json.
 * Preserves user-authored MCP entries (names not in MCP_TOGGLES).
 * For deselected toggles, removes the key entirely.
 *
 * enabledSet: Set of MCP toggle names that should be enabled
 */
export function writeMcpToggles(
  configPath: string,
  enabledSet: Set<string>,
  opts: { dryRun: boolean },
): { changed: boolean; bakPath?: string } {
  try {
    if (!fs.existsSync(configPath)) {
      return { changed: false };
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);

    const toggleNames = new Set(MCP_TOGGLES.map((t) => t.name));
    const existingMcp: Record<string, unknown> =
      config.mcp && typeof config.mcp === "object" ? { ...config.mcp } : {};

    // Build new mcp object: preserve user-authored entries, update toggles
    const newMcp: Record<string, unknown> = {};
    let hasChanges = false;

    // First, copy user-authored entries (non-toggle MCPs)
    for (const [key, val] of Object.entries(existingMcp)) {
      if (!toggleNames.has(key)) {
        newMcp[key] = val;
      }
    }

    // Then, apply toggle selections
    for (const toggleName of toggleNames) {
      if (enabledSet.has(toggleName)) {
        newMcp[toggleName] = { enabled: true };
        if (!deepEqual(existingMcp[toggleName], { enabled: true })) {
          hasChanges = true;
        }
      } else {
        // Toggle deselected: ensure it's not present
        if (existingMcp[toggleName] !== undefined) {
          hasChanges = true;
        }
      }
    }

    // Check if the mcp object as a whole changed
    if (!hasChanges && Object.keys(newMcp).length === Object.keys(existingMcp).length) {
      // Double-check all keys match
      const allKeysMatch = Object.keys(newMcp).every(
        (k) => deepEqual(newMcp[k], existingMcp[k]),
      );
      if (allKeysMatch) {
        return { changed: false };
      }
    }

    if (opts.dryRun) {
      info(`[dry-run] Would reconfigure MCP toggles`);
      return { changed: true };
    }

    // Write backup
    const bakPath = `${configPath}.bak.${Date.now()}-${process.pid}`;
    fs.copyFileSync(configPath, bakPath);

    // Update or remove mcp key
    if (Object.keys(newMcp).length > 0) {
      config.mcp = newMcp;
    } else {
      delete config.mcp;
    }

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    ok("Reconfigured MCPs");
    info(`Backup: ${bakPath}`);

    return { changed: true, bakPath };
  } catch {
    return { changed: false };
  }
}

export interface InstallOptions {
  dryRun?: boolean;
  pin?: boolean;
  nonInteractive?: boolean;
}

export async function install(opts: InstallOptions = {}): Promise<void> {
  const { dryRun = false, pin = false, nonInteractive = false } = opts;
  const configPath = getOpencodeConfigPath();
  const pluginEntry = pin ? `${PLUGIN_NAME}@${readPackageVersion()}` : PLUGIN_NAME;
  const interactive = !nonInteractive && process.stdin.isTTY === true;

  // Read existing config to detect what's already configured.
  const existing = readExistingConfig(configPath);
  const hasPlugin = existing
    ? (Array.isArray(existing.plugin) ? existing.plugin : []).some(
        (p: any) => {
          const name = typeof p === "string" ? p : Array.isArray(p) ? p[0] : null;
          return name === PLUGIN_NAME || String(name ?? "").startsWith(`${PLUGIN_NAME}@`);
        },
      )
    : false;
  const existingProvider = detectModelProvider(existing);
  const existingMcps = detectEnabledMcps(existing);
  const existingOpts = extractPluginOptions(existing);
  let hasModels = !!(existingOpts?.models ?? existing?.harness?.models);

  console.log(`\n${c.bold}${c.blue}@glrs-dev/harness-plugin-opencode${c.reset} setup\n`);

  // Show current state
  if (hasPlugin) {
    ok("Plugin already registered");
  }
  if (existingProvider) {
    ok(`Models: ${existingProvider}`);
  }
  if (existingMcps.size > 0) {
    ok(`MCPs: ${[...existingMcps].join(", ")} enabled`);
  }
  // Track reconfiguration choices for imperative overwrite path
  let reconfigureModels = false;
  let reconfigureMcps = false;
  let newModelsValue: { deep: string[]; mid: string[]; fast: string[] } | null = null;
  let newMcpEnabledSet: Set<string> = new Set();

  if (hasPlugin && (existingProvider || hasModels)) {
    // Everything that can be prompted for is already set.
    // Check if there are unconfigured MCPs to offer.
    const unconfiguredMcps = MCP_TOGGLES.filter(
      (t) => !existingMcps.has(t.name) && !existing?.mcp?.[t.name],
    );

    if (interactive) {
      // Offer to reconfigure models.
      const reconfigure = await promptChoice(
        "  Reconfigure models?",
        ["No, keep current config", "Yes, reconfigure models"],
        0,
      );
      if (reconfigure === 1) {
        reconfigureModels = true;
        // Fall through to the model prompt below by clearing hasModels.
        hasModels = false;
      }

      // Offer to reconfigure MCPs if any are already configured.
      if (existingMcps.size > 0) {
        const reconfigureMcpChoice = await promptChoice(
          "  Reconfigure MCPs?",
          ["No, keep current config", "Yes, reconfigure MCPs"],
          0,
        );
        if (reconfigureMcpChoice === 1) {
          reconfigureMcps = true;
        }
      }

      if (!reconfigureModels && !reconfigureMcps && unconfiguredMcps.length === 0) {
        console.log(`\n${c.bold}Ready.${c.reset} Run ${c.green}opencode${c.reset} to start.\n`);
        return;
      }
    } else if (unconfiguredMcps.length === 0) {
      console.log(`\n${c.bold}Ready.${c.reset} Run ${c.green}opencode${c.reset} to start.\n`);
      return;
    }
  }

  // Build the config to merge — always include the plugin entry.
  // Plugin options (models, etc.) go into the tuple form:
  //   plugin: [["@glrs-dev/harness-plugin-opencode", { models: {...} }]]
  const pluginOpts: Record<string, unknown> = {};

  // Model provider — only prompt if not already configured.
  if (interactive && !hasModels) {
    console.log();
    console.log(`${c.dim}Models${c.reset}`);

    // Try to fetch live providers from Models.dev; fall back to hardcoded presets.
    info("Fetching available providers…");
    const modelsDevProviders = await fetchModelsDevProviders();

    let preset: ModelPreset | null = null;

    if (modelsDevProviders && modelsDevProviders.length > 0) {
      // Build choices from live Models.dev data.
      const providerChoices = modelsDevProviders.map((p: ModelsDevProvider) => p.name);
      providerChoices.push("Keep defaults (no model config)");
      providerChoices.push("Custom (enter model IDs manually)");

      const keepDefaultsIdx = providerChoices.length - 2; // "Keep defaults" is second-to-last
      const providerIdx = await promptChoice(
        "  Which model provider?",
        providerChoices,
        keepDefaultsIdx,
      );

      if (providerIdx < modelsDevProviders.length) {
        const provider = modelsDevProviders[providerIdx]!;
        ok(`Provider: ${provider.name}`);

        // Amazon Bedrock ships both `global.anthropic.*` (CRIS) and
        // `anthropic.*` variants of the same models. Use the specialized
        // picker so the suggested defaults are the high-availability
        // CRIS routes — users can still override at the per-tier prompt.
        const suggested =
          provider.id === "amazon-bedrock"
            ? pickBedrockTierIds(provider)
            : suggestTiersFromModelsDev(provider);
        const modelChoices = Object.keys(provider.models).map(
          (modelId) => `${provider.id}/${modelId}`,
        );

        const tiers: Array<{ tier: string; suggested: string }> = [
          { tier: "deep", suggested: suggested.deep },
          { tier: "mid", suggested: suggested.mid },
          { tier: "fast", suggested: suggested.fast },
        ];

        const picked: Record<string, string> = {};
        for (const { tier, suggested: suggestedModel } of tiers) {
          const defaultIdx = modelChoices.indexOf(suggestedModel);
          const idx = await promptChoice(
            `  ${tier} model?`,
            modelChoices,
            defaultIdx >= 0 ? defaultIdx : 0,
          );
          picked[tier] = modelChoices[idx]!;
          info(`  ${tier} → ${picked[tier]}`);
        }

        preset = {
          label: provider.name,
          providerId: provider.id,
          deep: picked["deep"]!,
          mid: picked["mid"]!,
          fast: picked["fast"]!,
        };
      } else if (providerIdx === modelsDevProviders.length) {
        // "Keep defaults" — no model config, preset stays null, skip custom too.
        ok("Models: OpenCode defaults");
        // Signal that we should NOT fall through to the custom prompt.
        // Set a sentinel so the code below skips the custom input block.
        pluginOpts._skipModels = true;
      }
      // else: custom — preset stays null, handled below
    } else {
      // Offline fallback — use hardcoded presets.
      warn("Could not reach Models.dev API — using built-in presets");
      const presetLabels = [...MODEL_PRESETS.map((p) => p.label), "Keep defaults (no model config)", "Custom (enter model IDs manually)"];
      const keepDefaultsOfflineIdx = presetLabels.length - 2;
      const choice = await promptChoice(
        "  Which model provider?",
        presetLabels,
        keepDefaultsOfflineIdx,
      );

      if (choice < MODEL_PRESETS.length) {
        preset = MODEL_PRESETS[choice]!;
        ok(`Provider: ${preset.label}`);
      } else if (choice === MODEL_PRESETS.length) {
        // "Keep defaults" — no model config.
        ok("Models: OpenCode defaults");
        pluginOpts._skipModels = true;
      }
      // else: custom — preset stays null
    }

    if (preset) {
      pluginOpts.models = {
        deep: [preset.deep],
        mid: [preset.mid],
        fast: [preset.fast],
      };
      // Capture for reconfigure path
      newModelsValue = {
        deep: [preset.deep],
        mid: [preset.mid],
        fast: [preset.fast],
      };
      ok(`Models configured`);

      // Optional mid-execute tier: strict executor for build/pilot-builder.
      // If the user picks a model here, those agents get the strict-executor
      // prompt (narrower scope, escalation-first, no self-correction).
      // If skipped, they use the mid model with the reasoning prompt.
      const midExecIdx = await promptChoice(
        "  Use a strict executor for build agents? (recommended for Kimi/Qwen/DeepSeek)",
        ["No (use mid model as reasoning builder)", "Yes (configure mid-execute model)"],
        0,
      );
      if (midExecIdx === 1) {
        const { input } = await import("@inquirer/prompts");
        const midExecModel = await input({
          message: "  mid-execute model ID:",
          default: preset.mid,
        });
        if (midExecModel) {
          (pluginOpts.models as Record<string, string[]>)["mid-execute"] = [midExecModel];
          (newModelsValue as Record<string, string[]>)["mid-execute"] = [midExecModel];
          info(`  mid-execute → ${midExecModel} (strict executor prompts)`);
        }
      } else {
        info(`  mid-execute: skipped (build agents use mid model with reasoning prompts)`);
      }
    } else if (!pluginOpts._skipModels) {
      // Custom: ask for each tier manually.
      info("Enter model IDs in <provider>/<model-id> format (e.g. amazon-bedrock/global.anthropic.claude-opus-4-7)");
      const { input } = await import("@inquirer/prompts");
      const deepModel = await input({ message: "  deep (most capable):" });
      const midModel = await input({ message: "  mid (balanced):" });
      const fastModel = await input({ message: "  fast (cheapest):" });
      if (deepModel) {
        const resolvedMid = midModel || deepModel;
        pluginOpts.models = {
          deep: [deepModel],
          mid: [resolvedMid],
          fast: [fastModel || midModel || deepModel],
        };
        // Capture for reconfigure path
        newModelsValue = {
          deep: [deepModel],
          mid: [resolvedMid],
          fast: [fastModel || midModel || deepModel],
        };
        ok("Models: custom");

        // Optional mid-execute tier for custom path.
        const midExecModel = await input({ message: "  mid-execute (optional strict executor, press Enter to skip):" });
        if (midExecModel) {
          (pluginOpts.models as Record<string, string[]>)["mid-execute"] = [midExecModel];
          (newModelsValue as Record<string, string[]>)["mid-execute"] = [midExecModel];
          info(`  mid-execute → ${midExecModel} (strict executor prompts)`);
        } else {
          info(`  mid-execute: skipped (build agents use mid model with reasoning prompts)`);
        }
      } else {
        ok("Models: OpenCode defaults");
      }
    }
    // Clean up sentinel before writing to config.
    delete pluginOpts._skipModels;
    console.log();
  }

  // MCP reconfiguration prompt (when user opted in)
  if (interactive && reconfigureMcps) {
    console.log(`${c.dim}Reconfigure MCP servers${c.reset}`);
    const currentEnabled = new Set(existingMcps);
    const selected = await promptMulti(
      "  Select MCPs to enable:",
      MCP_TOGGLES.map((t) => ({ label: t.label, defaultOn: currentEnabled.has(t.name) })),
    );

    newMcpEnabledSet = new Set([...selected].map((i) => MCP_TOGGLES[i]!.name));

    const names = [...newMcpEnabledSet].join(", ");
    if (newMcpEnabledSet.size > 0) {
      ok(`MCPs to enable: ${names}`);
    } else {
      ok("MCPs: all disabled");
    }
    console.log();
  }

  // Build the plugin entry — tuple form if options exist, plain string otherwise.
  const pluginValue = Object.keys(pluginOpts).length > 0
    ? [pluginEntry, pluginOpts]
    : pluginEntry;

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    plugin: [pluginValue],
  };

  // Optional MCPs — only prompt for ones not already configured.
  if (interactive) {
    const unconfigured = MCP_TOGGLES.filter(
      (t) => !existingMcps.has(t.name) && !existing?.mcp?.[t.name],
    );

    if (unconfigured.length > 0) {
      console.log(`${c.dim}Optional MCP servers (serena, memory, git are always on)${c.reset}`);
      const selected = await promptMulti(
        "  Enable additional MCPs?",
        unconfigured.map((t) => ({ label: t.label, defaultOn: t.defaultOn })),
      );

      if (selected.size > 0) {
        const mcp: Record<string, unknown> = {};
        for (const idx of selected) {
          const toggle = unconfigured[idx]!;
          mcp[toggle.name] = { enabled: true };
        }
        (config as any).mcp = mcp;

        const names = [...selected].map((i) => unconfigured[i]!.name).join(", ");
        ok(`MCPs enabled: ${names}`);
      } else {
        ok("MCPs: defaults only");
      }
      console.log();
    }
  }

  // Write to opencode.json
  // Imperative reconfigure writes happen BEFORE mergeConfig so the merge
  // sees the freshly-written values (user-wins policy has nothing more to do).
  if (reconfigureModels && newModelsValue) {
    writePluginOption(configPath, "models", newModelsValue, { dryRun });
  }

  if (reconfigureMcps) {
    writeMcpToggles(configPath, newMcpEnabledSet, { dryRun });
  }

  if (!fs.existsSync(configPath)) {
    if (dryRun) {
      info(`[dry-run] Would create ${configPath}`);
      info(`[dry-run] Config: ${JSON.stringify(config, null, 2)}`);
    } else {
      seedConfig(config as any, configPath);
      ok(`Created ${configPath}`);
    }
  } else {
    try {
      const result = mergeConfig(config as any, configPath, dryRun);
      if (!result.changed) {
        ok("opencode.json is up to date");
        for (const w of result.warnings) warn(w);
      } else {
        if (dryRun) {
          info(`[dry-run] Would merge into ${configPath}:`);
          for (const a of result.additions) info(`  ${a}`);
        } else {
          ok(`Updated ${configPath}`);
          info(`Backup: ${result.bakPath}`);
          for (const a of result.additions) info(`  ${a}`);
        }
        for (const w of result.warnings) warn(w);
      }
    } catch (e: any) {
      console.error(`\x1b[31m✗\x1b[0m ${e.message}`);
      process.exit(1);
    }
  }

  // Migrate legacy `harness` top-level key → plugin options tuple.
  // OpenCode's config schema rejects unrecognized top-level keys, so
  // the old `harness` key must be removed. We move its contents into
  // the plugin tuple: ["@glrs-dev/harness-plugin-opencode", { models: {...} }].
  if (!dryRun) {
    migrateHarnessKeyToPluginOptions(configPath);
  }

  // Ensure the OpenCode plugin cache is up to date. The cache can get
  // stuck on a stale exact pin (e.g. "0.8.0") with no node_modules/,
  // which means the plugin never loads and the in-plugin auto-update
  // never runs — a chicken-and-egg problem. Fix it here.
  if (!dryRun) {
    await refreshPluginCacheIfStale();
  }

  console.log(`\n${c.bold}Ready.${c.reset} Run ${c.green}opencode${c.reset} to start.\n`);
}
