/**
 * `glrs oc configure` — Interactive configuration editor.
 *
 * Shows the current opencode.json config as a navigable menu.
 * The user selects a setting to change, picks from available options
 * (no free-text for model selection), and saves.
 *
 * Unlike `install`, this command:
 *   - Never re-prompts for settings you don't want to change
 *   - Shows model choices from the Models.dev API (not free-text)
 *   - Supports changing a single tier without touching others
 */

import { command } from "cmd-ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promptChoice, promptSelect, promptSearch, type SearchChoice } from "./plugin-check.js";
import { fetchModelsDevProviders, type ModelsDevProvider } from "./models-dev.js";
import { writePluginOption, writeMcpToggles, writePluginToggles } from "./install.js";
import type { ModelTier } from "../agents/index.js";

const PLUGIN_NAME = "@glrs-dev/harness-plugin-opencode";

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
};

const ok = (msg: string) => console.log(`${c.green}✓${c.reset} ${msg}`);
const info = (msg: string) => console.log(`${c.blue}•${c.reset} ${msg}`);

function getOpencodeConfigPath(): string {
  const configHome =
    process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode", "opencode.json");
}

function readConfig(configPath: string): Record<string, any> | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function extractPluginOptions(config: Record<string, any>): Record<string, any> | null {
  const plugins = config.plugin;
  if (!Array.isArray(plugins)) return null;
  for (const entry of plugins) {
    if (
      Array.isArray(entry) &&
      entry.length >= 2 &&
      (entry[0] === PLUGIN_NAME || String(entry[0]).startsWith(`${PLUGIN_NAME}@`) || String(entry[0]).startsWith("file://"))
    ) {
      return entry[1] as Record<string, any>;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier definitions — every tier from agents/index.ts ModelTier
// ---------------------------------------------------------------------------

interface TierDef {
  tier: ModelTier;
  label: string;
  agents: string;
  fallback?: string;
}

const TIER_DEFS: TierDef[] = [
  {
    tier: "deep",
    label: "deep",
    agents: "@plan, @prime, @architecture-advisor, @research, @build-deep, @code-reviewer-thorough",
  },
  {
    tier: "mid",
    label: "mid",
    agents: "@build, @docs-maintainer, @lib-reader, @plan-reviewer, @debriefer, @designer",
  },
  {
    tier: "mid-execute",
    label: "mid-execute",
    agents: "@build, @spec-reviewer, @code-reviewer (strict executor variant)",
    fallback: "mid",
  },
  {
    tier: "autopilot-execute",
    label: "autopilot",
    agents: "@autopilot-fast",
    fallback: "mid-execute → mid",
  },
  {
    tier: "fast",
    label: "fast",
    agents: "@code-searcher",
  },
  {
    tier: "cheap",
    label: "cheap",
    agents: "@build-cheap, @plan-cheap, @plan-ultra-cheap (cascading first-pass)",
    fallback: "fast",
  },
];

const BACK_SENTINEL = "__back__";

// Pad string to fixed width (visible characters only, ignoring ANSI codes)
function pad(s: string, width: number): string {
  // Strip ANSI escape sequences to measure visible length
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return s + " ".repeat(padding);
}

// Extract the short model name from a full model ID for summary display.
// "amazon-bedrock/global.anthropic.claude-opus-4-7" → "claude-opus-4-7"
// "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
function shortModelName(fullId: string): string {
  const afterSlash = fullId.split("/").pop() ?? fullId;
  // Strip provider prefixes like "global.anthropic."
  const parts = afterSlash.split(".");
  if (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    if (last.startsWith("claude-") || last.startsWith("haiku-")) return last;
  }
  return afterSlash;
}

// ---------------------------------------------------------------------------
// Model search — flat searchable list, model IDs as primary display
// ---------------------------------------------------------------------------

function buildModelSearchChoices(
  providers: ModelsDevProvider[],
  currentModel: string | undefined,
): SearchChoice<string>[] {
  const choices: SearchChoice<string>[] = [];

  for (const provider of providers) {
    const models = Object.entries(provider.models);
    if (models.length === 0) continue;

    for (const [modelId] of models) {
      const fullId = `${provider.id}/${modelId}`;
      const cost = (provider.models[modelId] as any)?.cost;

      let desc = provider.name;
      if (cost?.input != null && cost?.output != null) {
        desc += `  ·  in: $${cost.input}  out: $${cost.output}`;
      }
      if (fullId === currentModel) {
        desc += "  ✦ current";
      }

      choices.push({
        value: fullId,
        name: fullId,
        description: desc,
        short: fullId,
      });
    }
  }

  choices.push({
    value: BACK_SENTINEL,
    name: "← Back",
    description: "",
  });

  return choices;
}

// ---------------------------------------------------------------------------
// Tier selection — two-column layout with descriptions on focus
// ---------------------------------------------------------------------------

const TIER_NAME_WIDTH = 14;

function buildTierChoices(
  currentModels: Record<string, string[]>,
): ({ value: string; name: string; description: string; short: string } | { separator: string })[] {
  const choices: ({ value: string; name: string; description: string; short: string } | { separator: string })[] = [];

  for (const def of TIER_DEFS) {
    const model = currentModels[def.tier]?.[0];
    const tierLabel = pad(def.label, TIER_NAME_WIDTH);

    let valuePart: string;
    if (model) {
      valuePart = `${c.cyan}${model}${c.reset}`;
    } else if (def.fallback) {
      valuePart = `${c.dim}→ ${def.fallback}${c.reset}`;
    } else {
      valuePart = `${c.dim}(not set)${c.reset}`;
    }

    choices.push({
      value: def.tier,
      name: `${tierLabel}${valuePart}`,
      description: def.agents,
      short: def.label,
    });
  }

  choices.push({ separator: " " });
  choices.push({
    value: BACK_SENTINEL,
    name: "← Back",
    description: "",
    short: "back",
  });

  return choices;
}

// ---------------------------------------------------------------------------
// Configure: Models
// ---------------------------------------------------------------------------

async function configureModels(configPath: string, currentModels: Record<string, string[]>): Promise<void> {
  info("Fetching available models…");
  const providers = await fetchModelsDevProviders();

  while (true) {
    const tierChoices = buildTierChoices(currentModels);
    const selected = await promptSelect("Which tier?", tierChoices, BACK_SENTINEL);
    if (selected === BACK_SENTINEL) return;

    const def = TIER_DEFS.find((d) => d.tier === selected)!;
    const currentModel = currentModels[def.tier]?.[0];

    if (!providers || providers.length === 0) {
      console.log(`${c.yellow}!${c.reset} Could not reach Models.dev API. Enter model ID manually.`);
      const { input } = await import("@inquirer/prompts");
      const modelId = await input({
        message: `${def.label} model ID:`,
        default: currentModel ?? "",
      });
      if (modelId) {
        const newModels = { ...currentModels, [def.tier]: [modelId] };
        writePluginOption(configPath, "models", newModels, { dryRun: false });
        Object.assign(currentModels, { [def.tier]: [modelId] });
        ok(`${def.label} → ${modelId}`);
      }
      continue;
    }

    const choices = buildModelSearchChoices(providers, currentModel);
    const selectedModel = await promptSearch(
      `${def.label} model (type to filter):`,
      choices,
      BACK_SENTINEL,
    );

    if (selectedModel === BACK_SENTINEL) continue;

    const newModels = { ...currentModels, [def.tier]: [selectedModel] };
    writePluginOption(configPath, "models", newModels, { dryRun: false });
    Object.assign(currentModels, { [def.tier]: [selectedModel] });
    ok(`${def.label} → ${selectedModel}`);
  }
}

// ---------------------------------------------------------------------------
// Configure: Notifications
// ---------------------------------------------------------------------------

async function configureNotifications(configPath: string, currentNotifyUrl: string | undefined): Promise<string | undefined> {
  const urlDisplay = currentNotifyUrl
    ? `${c.cyan}${currentNotifyUrl}${c.reset}`
    : `${c.dim}none${c.reset}`;
  console.log(`\n  Webhook: ${urlDisplay}\n`);

  const choices = [
    "Set Slack incoming webhook URL",
    "Set custom webhook URL",
    "Clear webhook URL",
    "← Back",
  ];
  const choice = await promptChoice("Notifications:", choices, choices.length - 1);

  if (choice === choices.length - 1) return currentNotifyUrl;

  if (choice === 2) {
    writeNotifyUrl(configPath, undefined);
    ok("Webhook URL cleared.");
    return undefined;
  }

  const { input } = await import("@inquirer/prompts");
  const prompt = choice === 0
    ? "Slack incoming webhook URL:"
    : "Webhook URL:";
  const url = await input({
    message: prompt,
    default: currentNotifyUrl ?? "",
  });

  if (url) {
    writeNotifyUrl(configPath, url);
    ok(`Webhook URL set.`);
    return url;
  }

  return currentNotifyUrl;
}

function writeNotifyUrl(configPath: string, url: string | undefined): void {
  try {
    if (!fs.existsSync(configPath)) return;
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    if (!Array.isArray(config.plugin)) return;

    const pluginIdx = config.plugin.findIndex((entry: any) => {
      const name = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : null;
      return (
        name === PLUGIN_NAME ||
        String(name ?? "").startsWith(`${PLUGIN_NAME}@`) ||
        String(name ?? "").includes("harness-opencode")
      );
    });
    if (pluginIdx < 0) return;

    const current = config.plugin[pluginIdx];
    const pluginName = Array.isArray(current) ? current[0] : current;
    const existingOpts = Array.isArray(current) && current.length >= 2 ? { ...current[1] } : {};

    if (url === undefined) {
      delete existingOpts.notifyUrl;
    } else {
      existingOpts.notifyUrl = url;
    }

    config.plugin[pluginIdx] = [pluginName, existingOpts];

    const bakPath = `${configPath}.bak.${Date.now()}-${process.pid}`;
    fs.copyFileSync(configPath, bakPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\x1b[33m⚠ Failed to write notifyUrl: ${msg}\x1b[0m\n`);
  }
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

export const configureCmd = command({
  name: "configure",
  description: "Interactively edit opencode.json settings — models, MCPs, plugin add-ons.",
  args: {},
  handler: async () => {
    const configPath = getOpencodeConfigPath();
    const config = readConfig(configPath);

    if (!config) {
      console.log(`No config found at ${configPath}. Run ${c.green}glrs harness install${c.reset} first.`);
      process.exit(1);
    }

    const opts = extractPluginOptions(config);
    const models: Record<string, string[]> = opts?.models ?? {};
    let notifyUrl: string | undefined = opts?.notifyUrl as string | undefined;

    console.log(`\n${c.bold}glrs harness configure${c.reset}\n`);

    while (true) {
      const deepShort = shortModelName(models.deep?.[0] ?? "");
      const midShort = shortModelName(models.mid?.[0] ?? "");
      const modelSummary = deepShort && midShort
        ? `deep: ${deepShort}  ·  mid: ${midShort}`
        : deepShort || midShort || "(not configured)";

      const mcpEnabled = Object.entries(config.mcp ?? {})
        .filter(([, v]: [string, any]) => v?.enabled)
        .map(([k]) => k);

      const slackConfigured = notifyUrl?.includes("hooks.slack.com/") ?? false;
      const notifyLabel = notifyUrl
        ? (slackConfigured ? "Slack" : "custom webhook")
        : "none";

      const sections = [
        `Models\n    ${c.dim}${modelSummary}${c.reset}`,
        `MCPs — ${mcpEnabled.length > 0 ? mcpEnabled.join(", ") : "none"}`,
        `Notifications — ${notifyLabel}`,
        "Done",
      ];

      const choice = await promptChoice("What to configure?", sections, sections.length - 1);

      if (choice === sections.length - 1) {
        console.log(`\nRestart opencode to pick up changes.\n`);
        break;
      }

      if (choice === 0) {
        await configureModels(configPath, models);
        const updated = readConfig(configPath);
        if (updated) {
          const updatedOpts = extractPluginOptions(updated);
          if (updatedOpts?.models) {
            Object.assign(models, updatedOpts.models);
          }
        }
      }

      if (choice === 1) {
        const { promptMulti } = await import("./plugin-check.js");
        const MCP_TOGGLES = [
          { name: "playwright", label: "Playwright — browser automation" },
          { name: "linear", label: "Linear — issue tracker" },
        ];
        const currentMcps = new Set(
          Object.entries(config.mcp ?? {})
            .filter(([, v]: [string, any]) => v?.enabled)
            .map(([k]) => k),
        );
        const selected = await promptMulti(
          "Enable MCPs:",
          MCP_TOGGLES.map((t) => ({ label: t.label, defaultOn: currentMcps.has(t.name) })),
        );
        const newEnabled = new Set([...selected].map((i) => MCP_TOGGLES[i]!.name));
        writeMcpToggles(configPath, newEnabled, { dryRun: false });
      }

      if (choice === 2) {
        notifyUrl = await configureNotifications(configPath, notifyUrl);
      }
    }
  },
});
