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
import { promptChoice, promptSearch, type SearchChoice } from "./plugin-check.js";
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
    label: "Deep",
    agents: "@plan, @prime, @architecture-advisor, @research, @build-deep, @code-reviewer-thorough",
  },
  {
    tier: "mid",
    label: "Mid",
    agents: "@build, @docs-maintainer, @lib-reader, @plan-reviewer, @debriefer, @designer",
  },
  {
    tier: "mid-execute",
    label: "Mid-execute",
    agents: "@build, @spec-reviewer, @code-reviewer (strict executor variant)",
    fallback: "mid",
  },
  {
    tier: "autopilot-execute",
    label: "Autopilot",
    agents: "@autopilot-fast",
    fallback: "mid-execute → mid",
  },
  {
    tier: "fast",
    label: "Fast",
    agents: "@code-searcher",
  },
  {
    tier: "cheap",
    label: "Cheap",
    agents: "@build-cheap, @plan-cheap, @plan-ultra-cheap (cascading first-pass)",
    fallback: "fast",
  },
];

// ---------------------------------------------------------------------------
// Model selection — single searchable list of provider/model
// ---------------------------------------------------------------------------

const BACK_SENTINEL = "__back__";

function buildModelSearchChoices(
  providers: ModelsDevProvider[],
  currentModel: string | undefined,
): SearchChoice<string>[] {
  const choices: SearchChoice<string>[] = [];

  for (const provider of providers) {
    const models = Object.entries(provider.models);
    if (models.length === 0) continue;

    for (const [modelId, model] of models) {
      const fullId = `${provider.id}/${modelId}`;
      const name = (model as any).name ?? modelId;
      const cost = (model as any).cost;
      let desc = provider.name;
      if (cost?.input != null && cost?.output != null) {
        desc += ` · $${cost.input}/${cost.output} per 1M tok`;
      }
      if (fullId === currentModel) {
        desc += " (current)";
      }
      choices.push({
        value: fullId,
        name: `${provider.id}/${name}`,
        description: desc,
        short: fullId,
      });
    }
  }

  choices.push({
    value: BACK_SENTINEL,
    name: "← Back",
    description: "Return to tier list",
  });

  return choices;
}

async function configureModels(configPath: string, currentModels: Record<string, string[]>): Promise<void> {
  // Fetch models once, reuse across tier selections
  info("Fetching available models…");
  const providers = await fetchModelsDevProviders();

  while (true) {
    // Build tier menu with current values
    console.log();
    const tierChoices = TIER_DEFS.map((def) => {
      const model = currentModels[def.tier]?.[0];
      const fallbackNote = !model && def.fallback
        ? `${c.dim}(falls back to ${def.fallback})${c.reset}`
        : "";
      const modelDisplay = model
        ? `${c.cyan}${model}${c.reset}`
        : `${c.dim}(not set)${c.reset} ${fallbackNote}`;
      return `${c.bold}${def.label}${c.reset}  ${modelDisplay}\n    ${c.dim}${def.agents}${c.reset}`;
    });
    tierChoices.push("← Back");

    const tierIdx = await promptChoice("Which tier to change?", tierChoices, tierChoices.length - 1);
    if (tierIdx >= TIER_DEFS.length) return;

    const def = TIER_DEFS[tierIdx]!;
    const currentModel = currentModels[def.tier]?.[0];

    if (!providers || providers.length === 0) {
      console.log(`${c.yellow}!${c.reset} Could not reach Models.dev API. Enter model ID manually.`);
      const { input } = await import("@inquirer/prompts");
      const modelId = await input({
        message: `  ${def.tier} model ID:`,
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
    const selected = await promptSearch(
      `${def.label} model (type to search):`,
      choices,
      BACK_SENTINEL,
    );

    if (selected === BACK_SENTINEL) continue;

    if (selected === "") {
      // Clear the tier override
      const newModels = { ...currentModels };
      delete newModels[def.tier];
      writePluginOption(configPath, "models", newModels, { dryRun: false });
      Object.assign(currentModels, newModels);
      ok(`${def.label} tier cleared (will use fallback)`);
    } else {
      const newModels = { ...currentModels, [def.tier]: [selected] };
      writePluginOption(configPath, "models", newModels, { dryRun: false });
      Object.assign(currentModels, { [def.tier]: [selected] });
      ok(`${def.label} → ${selected}`);
    }
  }
}

async function configureNotifications(configPath: string, currentNotifyUrl: string | undefined): Promise<string | undefined> {
  console.log(`\n${c.bold}Notifications configuration:${c.reset}\n`);
  if (currentNotifyUrl) {
    console.log(`  Current webhook URL: ${c.cyan}${currentNotifyUrl}${c.reset}\n`);
  } else {
    console.log(`  ${c.dim}No webhook URL configured.${c.reset}\n`);
  }

  const choices = [
    "Set Slack incoming webhook URL",
    "Set custom webhook URL",
    "Clear webhook URL",
    "← Back",
  ];
  const choice = await promptChoice("Notifications:", choices, choices.length - 1);

  if (choice === choices.length - 1) return currentNotifyUrl; // Back

  if (choice === 2) {
    // Clear — write null to the plugin option
    writeNotifyUrl(configPath, undefined);
    ok("Webhook URL cleared.");
    return undefined;
  }

  const { input } = await import("@inquirer/prompts");
  const prompt = choice === 0
    ? "  Slack incoming webhook URL (https://hooks.slack.com/...):"
    : "  Webhook URL:";
  const url = await input({
    message: prompt,
    default: currentNotifyUrl ?? "",
  });

  if (url) {
    writeNotifyUrl(configPath, url);
    ok(`Webhook URL set: ${url}`);
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

    console.log(`\n${c.bold}${c.blue}glrs oc configure${c.reset}\n`);

    while (true) {
      // Compact status line for each tier
      const tierSummary = TIER_DEFS.map((def) => {
        const model = models[def.tier]?.[0];
        const short = model ? model.split("/").pop() : (def.fallback ? `→${def.fallback}` : "–");
        return `${def.label}: ${short}`;
      }).join(", ");

      const mcpEnabled = Object.entries(config.mcp ?? {})
        .filter(([, v]: [string, any]) => v?.enabled)
        .map(([k]) => k);

      const slackConfigured = notifyUrl?.includes("hooks.slack.com/") ?? false;
      const notifyLabel = notifyUrl
        ? (slackConfigured ? "Slack" : "custom webhook")
        : "none";

      const sections = [
        `Models — ${tierSummary}`,
        `MCPs — ${mcpEnabled.length > 0 ? mcpEnabled.join(", ") : "none"}`,
        `Notifications — ${notifyLabel}`,
        "Done",
      ];

      const choice = await promptChoice("What to configure?", sections, sections.length - 1);

      if (choice === sections.length - 1) {
        console.log(`\n${c.bold}Done.${c.reset} Restart opencode to pick up changes.\n`);
        break;
      }

      if (choice === 0) {
        await configureModels(configPath, models);
        // Re-read config after changes
        const updated = readConfig(configPath);
        if (updated) {
          const updatedOpts = extractPluginOptions(updated);
          if (updatedOpts?.models) {
            Object.assign(models, updatedOpts.models);
          }
        }
      }

      if (choice === 1) {
        // MCP toggles
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
        // Notifications
        notifyUrl = await configureNotifications(configPath, notifyUrl);
      }
    }
  },
});
