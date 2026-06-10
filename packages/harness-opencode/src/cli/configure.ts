/**
 * `glrs harness configure` — Interactive configuration editor.
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
import {
  menuSelect,
  menuAutocomplete,
  menuMultiselect,
  menuText,
  intro,
  outro,
  type MenuOption,
} from "./clack.js";
import { fetchModelsDevProviders, type ModelsDevProvider } from "./models-dev.js";
import { writePluginOption, writeMcpToggles } from "./install.js";
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
): MenuOption<string>[] {
  const choices: MenuOption<string>[] = [];

  for (const provider of providers) {
    const models = Object.entries(provider.models);
    if (models.length === 0) continue;

    for (const [modelId] of models) {
      const fullId = `${provider.id}/${modelId}`;
      const cost = (provider.models[modelId] as any)?.cost;

      let hint = provider.name;
      if (cost?.input != null && cost?.output != null) {
        hint += `  ·  in: $${cost.input}  out: $${cost.output}`;
      }
      if (fullId === currentModel) {
        hint += "  ✦ current";
      }

      choices.push({ value: fullId, label: fullId, hint });
    }
  }

  return choices;
}

// ---------------------------------------------------------------------------
// Tier selection — two-column layout with descriptions on focus
// ---------------------------------------------------------------------------

const TIER_NAME_WIDTH = 14;

function buildTierChoices(
  currentModels: Record<string, string[]>,
): MenuOption<string>[] {
  // Plain-text labels — clack styles the focused/unfocused rows itself, and
  // embedded ANSI resets would cut its highlight color mid-line.
  return TIER_DEFS.map((def) => {
    const model = currentModels[def.tier]?.[0];
    const valuePart = model ?? (def.fallback ? `→ ${def.fallback}` : "(not set)");
    return {
      value: def.tier,
      label: `${pad(def.label, TIER_NAME_WIDTH)}${valuePart}`,
      hint: def.agents,
    };
  });
}

// ---------------------------------------------------------------------------
// Configure: Models
// ---------------------------------------------------------------------------

async function configureModels(configPath: string, currentModels: Record<string, string[]>): Promise<void> {
  info("Fetching available models…");
  const providers = await fetchModelsDevProviders();

  while (true) {
    const tierChoices = buildTierChoices(currentModels);
    const selected = await menuSelect("Which tier?", tierChoices, BACK_SENTINEL);
    if (selected === BACK_SENTINEL) return;

    const def = TIER_DEFS.find((d) => d.tier === selected)!;
    const currentModel = currentModels[def.tier]?.[0];

    if (!providers || providers.length === 0) {
      console.log(`${c.yellow}!${c.reset} Could not reach Models.dev API. Enter model ID manually.`);
      const modelId = await menuText(`${def.label} model ID:`, {
        initialValue: currentModel,
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
    const selectedModel = await menuAutocomplete(
      `${def.label} model:`,
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
// Configure: Council
// ---------------------------------------------------------------------------

interface CouncilOptions {
  members?: string[];
  chairman?: string;
  timeoutMs?: number;
}

const USE_DEFAULT_SENTINEL = "__use_default__";

function councilSummary(council: CouncilOptions, models: Record<string, string[]>): string {
  const members = council.members ?? [];
  if (members.length < 2) return "(not configured)";
  const chairman = council.chairman ?? models["deep"]?.[0] ?? members[0]!;
  return `${members.length} members  ·  chairman: ${shortModelName(chairman!)}`;
}

/**
 * Council config editor. The council needs >= 2 members before the plugin
 * registers the tool, so the menu surfaces that state explicitly instead of
 * leaving a 1-member config silently inert.
 */
async function configureCouncil(
  configPath: string,
  council: CouncilOptions,
  currentModels: Record<string, string[]>,
): Promise<void> {
  info("Fetching available models…");
  const providers = await fetchModelsDevProviders();

  const persist = () => {
    const value: CouncilOptions | undefined =
      (council.members?.length ?? 0) > 0 || council.chairman
        ? {
            ...(council.members?.length ? { members: council.members } : {}),
            ...(council.chairman ? { chairman: council.chairman } : {}),
            ...(council.timeoutMs ? { timeoutMs: council.timeoutMs } : {}),
          }
        : undefined;
    writePluginOption(configPath, "council", value, { dryRun: false });
  };

  const pickModel = async (message: string, current?: string): Promise<string | null> => {
    if (!providers || providers.length === 0) {
      console.log(`${c.yellow}!${c.reset} Could not reach Models.dev API. Enter model ID manually.`);
      return menuText(message, { initialValue: current });
    }
    const choices = buildModelSearchChoices(providers, current);
    const selected = await menuAutocomplete(message, choices, BACK_SENTINEL);
    return selected === BACK_SENTINEL ? null : selected;
  };

  while (true) {
    const members = council.members ?? [];
    const defaultChairman = currentModels["deep"]?.[0] ?? members[0];
    const chairmanDisplay = council.chairman
      ? `${c.cyan}${council.chairman}${c.reset}`
      : `${c.dim}default (${defaultChairman ?? "first member"})${c.reset}`;

    console.log(`\n  ${c.bold}Council${c.reset} — multi-model deliberation for @prime (llm-council style)`);
    if (members.length === 0) {
      console.log(`  Members:  ${c.dim}none — council disabled${c.reset}`);
    } else {
      members.forEach((m, i) => console.log(`  ${i === 0 ? "Members: " : "         "} ${c.cyan}${m}${c.reset}`));
      if (members.length < 2) {
        console.log(`  ${c.yellow}! needs at least 2 members before the council tool activates${c.reset}`);
      }
    }
    console.log(`  Chairman: ${chairmanDisplay}\n`);

    const choices: MenuOption<string>[] = [
      {
        value: "add",
        label: "Add member",
        hint: "Add a model to the council (each member answers and peer-reviews)",
      },
    ];
    if (members.length > 0) {
      choices.push({
        value: "remove",
        label: "Remove members",
        hint: "Uncheck members to drop them from the council",
      });
    }
    choices.push({
      value: "chairman",
      label: "Set chairman",
      hint: "The model that synthesizes the final answer (defaults to the deep tier model)",
    });
    if (members.length > 0 || council.chairman) {
      choices.push({
        value: "clear",
        label: "Clear council config",
        hint: "Remove all council settings — disables the council tool",
      });
    }

    const action = await menuSelect("Council:", choices, BACK_SENTINEL);
    if (action === BACK_SENTINEL) return;

    if (action === "add") {
      const model = await pickModel("Add council member (type to filter):");
      if (model && !members.includes(model)) {
        council.members = [...members, model];
        persist();
        ok(`Added ${model}`);
      } else if (model) {
        info(`${model} is already a member.`);
      }
    }

    if (action === "remove") {
      const kept = await menuMultiselect(
        "Keep which members?",
        members.map((m) => ({ value: m, label: m })),
        members,
      );
      // null = backed out — no change.
      if (kept !== null && kept.length !== members.length) {
        council.members = members.filter((m) => kept.includes(m));
        persist();
        ok(`Council members: ${council.members.length > 0 ? council.members.join(", ") : "(none)"}`);
      }
    }

    if (action === "chairman") {
      const defaultLabel = `Use default (deep tier${defaultChairman ? `: ${defaultChairman}` : ""})`;
      const mode = await menuSelect(
        "Chairman:",
        [
          { value: USE_DEFAULT_SENTINEL, label: defaultLabel, hint: "Follows the deep tier as you reconfigure it" },
          { value: "pick", label: "Pick a specific model", hint: "Pin the chairman to one model" },
        ],
        BACK_SENTINEL,
      );
      if (mode === USE_DEFAULT_SENTINEL) {
        delete council.chairman;
        persist();
        ok("Chairman → deep tier default");
      } else if (mode === "pick") {
        const model = await pickModel("Chairman model (type to filter):", council.chairman);
        if (model) {
          council.chairman = model;
          persist();
          ok(`Chairman → ${model}`);
        }
      }
    }

    if (action === "clear") {
      delete council.members;
      delete council.chairman;
      delete council.timeoutMs;
      persist();
      ok("Council config cleared.");
    }
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

  const choices: MenuOption<string>[] = [
    { value: "slack", label: "Set Slack incoming webhook URL" },
    { value: "custom", label: "Set custom webhook URL" },
    { value: "clear", label: "Clear webhook URL" },
  ];
  const choice = await menuSelect("Notifications:", choices, BACK_SENTINEL);

  if (choice === BACK_SENTINEL) return currentNotifyUrl;

  if (choice === "clear") {
    writeNotifyUrl(configPath, undefined);
    ok("Webhook URL cleared.");
    return undefined;
  }

  const prompt = choice === "slack"
    ? "Slack incoming webhook URL:"
    : "Webhook URL:";
  const url = await menuText(prompt, { initialValue: currentNotifyUrl });

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
    const council: CouncilOptions = (opts?.council as CouncilOptions) ?? {};
    let notifyUrl: string | undefined = opts?.notifyUrl as string | undefined;

    intro("glrs harness configure");

    // Each section knows its name, how to summarize its current state (the
    // hint shown beside the focused row), and how to run its own editor.
    // Adding a section = adding an entry here, not extending an if-chain
    // over menu indices.
    const sections: { name: string; summary: () => string; run: () => Promise<void> }[] = [
      {
        name: "Models",
        summary: () => {
          const summary = TIER_DEFS
            .filter((def) => models[def.tier]?.[0])
            .map((def) => `${def.label}: ${shortModelName(models[def.tier]![0]!)}`)
            .join("  ·  ");
          return summary || "(not configured)";
        },
        run: async () => {
          await configureModels(configPath, models);
          const updated = readConfig(configPath);
          if (updated) {
            const updatedOpts = extractPluginOptions(updated);
            if (updatedOpts?.models) {
              Object.assign(models, updatedOpts.models);
            }
          }
        },
      },
      {
        name: "MCPs",
        summary: () => {
          const mcpEnabled = Object.entries(config.mcp ?? {})
            .filter(([, v]: [string, any]) => v?.enabled)
            .map(([k]) => k);
          return mcpEnabled.length > 0 ? mcpEnabled.join(", ") : "none";
        },
        run: async () => {
          const MCP_TOGGLES = [
            { name: "playwright", label: "Playwright — browser automation" },
            { name: "linear", label: "Linear — issue tracker" },
          ];
          const currentMcps = Object.entries(config.mcp ?? {})
            .filter(([, v]: [string, any]) => v?.enabled)
            .map(([k]) => k);
          const selected = await menuMultiselect(
            "Enable MCPs:",
            MCP_TOGGLES.map((t) => ({ value: t.name, label: t.label })),
            MCP_TOGGLES.map((t) => t.name).filter((n) => currentMcps.includes(n)),
          );
          // null = backed out — no change.
          if (selected === null) return;
          const newEnabled = new Set(selected);
          writeMcpToggles(configPath, newEnabled, { dryRun: false });
          // Keep the in-memory snapshot in sync so the summary line updates.
          config.mcp = config.mcp ?? {};
          for (const t of MCP_TOGGLES) {
            if (newEnabled.has(t.name)) {
              config.mcp[t.name] = { ...(config.mcp[t.name] ?? {}), enabled: true };
            } else {
              delete config.mcp[t.name];
            }
          }
        },
      },
      {
        name: "Council",
        summary: () => councilSummary(council, models),
        run: () => configureCouncil(configPath, council, models),
      },
      {
        name: "Notifications",
        summary: () => {
          const slackConfigured = notifyUrl?.includes("hooks.slack.com/") ?? false;
          return notifyUrl ? (slackConfigured ? "Slack" : "custom webhook") : "none";
        },
        run: async () => {
          notifyUrl = await configureNotifications(configPath, notifyUrl);
        },
      },
    ];

    const DONE = -1;
    while (true) {
      const choices: MenuOption<number>[] = sections.map((s, i) => ({
        value: i,
        label: s.name,
        hint: s.summary(),
      }));
      choices.push({ value: DONE, label: "Done", hint: "Save and exit (esc also exits)" });

      const choice = await menuSelect("What to configure?", choices, DONE);

      // Esc at the top level = done.
      if (choice === DONE) {
        outro("Restart opencode to pick up changes.");
        break;
      }

      await sections[choice]!.run();
    }
  },
});
