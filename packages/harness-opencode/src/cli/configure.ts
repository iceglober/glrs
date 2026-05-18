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
import { promptChoice } from "./plugin-check.js";
import { fetchModelsDevProviders, type ModelsDevProvider } from "./models-dev.js";
import { writePluginOption, writeMcpToggles, writePluginToggles } from "./install.js";

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

const TIER_LABELS: Record<string, string> = {
  deep: "@plan, @prime, @architecture-advisor",
  mid: "@build, @docs-maintainer, @lib-reader",
  "mid-execute": "@build, @spec-reviewer, @code-reviewer (overrides mid when set)",
  "autopilot-execute": "autopilot --fast",
  fast: "@code-searcher",
};

const TIERS = ["deep", "mid", "mid-execute", "autopilot-execute", "fast"] as const;

async function configureModels(configPath: string, currentModels: Record<string, string[]>): Promise<void> {
  // Show current config
  console.log(`\n${c.bold}Current model configuration:${c.reset}\n`);
  for (const tier of TIERS) {
    const model = currentModels[tier]?.[0] ?? "(not set)";
    const label = TIER_LABELS[tier] ?? tier;
    console.log(`  ${c.cyan}${label}${c.reset}`);
    console.log(`    ${model}\n`);
  }
  console.log();

  // Which tier to change?
  const tierChoices = [
    ...TIERS.map((t) => {
      const label = TIER_LABELS[t] ?? t;
      const model = currentModels[t]?.[0] ?? "(not set)";
      return `${label}  →  ${model}`;
    }),
    "← Back",
  ];
  const tierIdx = await promptChoice("Which tier to change?", tierChoices, tierChoices.length - 1);
  if (tierIdx >= TIERS.length) return; // Back

  const tier = TIERS[tierIdx];

  // Fetch available models
  info("Fetching available models…");
  const providers = await fetchModelsDevProviders();

  if (!providers || providers.length === 0) {
    console.log(`${c.yellow}!${c.reset} Could not reach Models.dev API. Enter model ID manually.`);
    const { input } = await import("@inquirer/prompts");
    const modelId = await input({
      message: `  ${tier} model ID:`,
      default: currentModels[tier]?.[0] ?? "",
    });
    if (modelId) {
      const newModels = { ...currentModels, [tier]: [modelId] };
      writePluginOption(configPath, "models", newModels, { dryRun: false });
    }
    return;
  }

  // Build a flat list of all models across all providers
  const allModels: Array<{ id: string; provider: string; name: string }> = [];
  for (const provider of providers) {
    for (const [modelId, model] of Object.entries(provider.models)) {
      allModels.push({
        id: `${provider.id}/${modelId}`,
        provider: provider.name,
        name: (model as any).name ?? modelId,
      });
    }
  }

  // Group by provider for display
  const byProvider = new Map<string, typeof allModels>();
  for (const m of allModels) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider)!.push(m);
  }

  // First pick provider
  const providerNames = [...byProvider.keys()];
  providerNames.push("← Back");
  const providerIdx = await promptChoice(`Provider for ${tier}:`, providerNames, 0);
  if (providerIdx >= providerNames.length - 1) return;

  const providerModels = byProvider.get(providerNames[providerIdx])!;
  const modelChoices = providerModels.map((m) => m.id);
  modelChoices.push("← Back");

  // Find current model in the list for default selection
  const currentModel = currentModels[tier]?.[0] ?? "";
  const currentIdx = modelChoices.indexOf(currentModel);

  const modelIdx = await promptChoice(
    `${tier} model:`,
    modelChoices,
    currentIdx >= 0 ? currentIdx : 0,
  );
  if (modelIdx >= modelChoices.length - 1) return;

  const selectedModel = modelChoices[modelIdx];
  const newModels = { ...currentModels, [tier]: [selectedModel] };
  writePluginOption(configPath, "models", newModels, { dryRun: false });
  ok(`${tier} → ${selectedModel}`);
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

/**
 * Write the notifyUrl plugin option directly to the config file.
 * Uses the same plugin-entry lookup as writePluginOption but handles
 * the "notifyUrl" key which is not in writePluginOption's allowed set.
 */
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
      console.log(`No config found at ${configPath}. Run ${c.green}glrs oc install${c.reset} first.`);
      process.exit(1);
    }

    const opts = extractPluginOptions(config);
    const models: Record<string, string[]> = opts?.models ?? {};
    let notifyUrl: string | undefined = opts?.notifyUrl as string | undefined;

    console.log(`\n${c.bold}${c.blue}glrs oc configure${c.reset}\n`);

    while (true) {
      // Show current state summary
      const deepModel = models.deep?.[0] ?? "(not set)";
      const midModel = models.mid?.[0] ?? "(not set)";
      const midExecModel = models["mid-execute"]?.[0] ?? "(not set)";
      const autopilotExecModel = models["autopilot-execute"]?.[0] ?? `(falls back to ${midExecModel})`;
      const fastModel = models.fast?.[0] ?? "(not set)";

      const mcpEnabled = Object.entries(config.mcp ?? {})
        .filter(([, v]: [string, any]) => v?.enabled)
        .map(([k]) => k);

      const slackConfigured = notifyUrl?.includes("hooks.slack.com/") ?? false;
      const notifyLabel = notifyUrl
        ? (slackConfigured ? "Slack" : "custom webhook")
        : "none";

      const sections = [
        `Models — deep: ${deepModel.split("/").pop()}, autopilot --fast: ${autopilotExecModel.split("/").pop()}`,
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
