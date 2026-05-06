/**
 * `pilot configure` — interactive configuration for pilot v2.
 *
 * Walks the user through:
 *   1. Per-phase model selection (searchable autocomplete)
 *   2. Verify commands (baseline + after_each)
 *   3. Max assess cycles
 *   4. Playwright toggle + base URL
 *
 * Reads existing .glrs/pilot.json as defaults.
 * Writes the result back to .glrs/pilot.json.
 */

import { command } from "cmd-ts";
import { input, select, confirm, number } from "@inquirer/prompts";
import { loadPilotConfig, writePilotConfig, DEFAULT_CONFIG, type PilotConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Model suggestions (searchable)
// ---------------------------------------------------------------------------

const MODEL_SUGGESTIONS = [
  // Anthropic
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  // Amazon Bedrock
  "amazon-bedrock/global.anthropic.claude-opus-4-7",
  "amazon-bedrock/global.anthropic.claude-sonnet-4-6",
  "amazon-bedrock/global.anthropic.claude-haiku-4-5",
  // OpenAI
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3",
  "openai/o4-mini",
  // Google
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  // DeepSeek
  "deepseek/deepseek-chat",
  // Qwen
  "qwen/qwen3-coder",
];

async function promptModel(phase: string, current: string): Promise<string> {
  // Build choices: current value first (if not in suggestions), then suggestions
  const choices = MODEL_SUGGESTIONS.includes(current)
    ? MODEL_SUGGESTIONS.map((m) => ({ name: m, value: m }))
    : [
        { name: `${current} (current)`, value: current },
        ...MODEL_SUGGESTIONS.map((m) => ({ name: m, value: m })),
      ];

  return select({
    message: `Model for ${phase} phase:`,
    choices,
    default: current,
  });
}

async function promptVerifyCommands(label: string, current: string[]): Promise<string[]> {
  const currentStr = current.join(", ");
  const raw = await input({
    message: `${label} commands (comma-separated, empty to clear):`,
    default: currentStr,
  });
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const configureCmd = command({
  name: "configure",
  description: "Interactively configure pilot v2 for this repo (.glrs/pilot.json).",
  args: {},
  handler: async () => {
    const cwd = process.cwd();

    if (!process.stdin.isTTY) {
      process.stderr.write(
        "pilot configure: requires an interactive terminal (TTY).\n" +
        "  Edit .glrs/pilot.json directly for non-interactive configuration.\n",
      );
      process.exit(1);
    }

    const current = loadPilotConfig(cwd);

    console.log("\n\x1b[1mPilot v2 Configuration\x1b[0m");
    console.log("Configure per-phase models, verify commands, and behavior.\n");

    // --- Models ---
    console.log("\x1b[2m── Models ──────────────────────────────────────────\x1b[0m");
    const scopeModel   = await promptModel("scope",   current.models.scope);
    const planModel    = await promptModel("plan",    current.models.plan);
    const executeModel = await promptModel("execute", current.models.execute);
    const assessModel  = await promptModel("assess",  current.models.assess);

    // --- Verify ---
    console.log("\n\x1b[2m── Verify commands ─────────────────────────────────\x1b[0m");
    const baseline   = await promptVerifyCommands("Baseline (run before execution)", current.verify.baseline);
    const after_each = await promptVerifyCommands("After-each (run after each task)", current.verify.after_each);

    // --- Assess cycles ---
    console.log("\n\x1b[2m── Assess loop ─────────────────────────────────────\x1b[0m");
    const max_assess_cycles = await number({
      message: "Max assess cycles (how many times to re-plan on failure):",
      default: current.max_assess_cycles,
      min: 1,
      max: 10,
    }) ?? current.max_assess_cycles;

    // --- Playwright ---
    console.log("\n\x1b[2m── Playwright (optional visual testing) ────────────\x1b[0m");
    const playwrightEnabled = await confirm({
      message: "Enable Playwright MCP for visual verification in Assess?",
      default: current.playwright.enabled,
    });

    let playwrightBaseUrl = current.playwright.base_url;
    if (playwrightEnabled) {
      playwrightBaseUrl = await input({
        message: "Playwright base URL:",
        default: current.playwright.base_url,
      });
    }

    // --- Write ---
    const config: PilotConfig = {
      models: {
        scope:   scopeModel,
        plan:    planModel,
        execute: executeModel,
        assess:  assessModel,
      },
      verify: { baseline, after_each },
      max_assess_cycles,
      playwright: { enabled: playwrightEnabled, base_url: playwrightBaseUrl },
    };

    writePilotConfig(cwd, config);

    console.log("\n\x1b[32m✓\x1b[0m Configuration saved to .glrs/pilot.json");
    console.log("  Run \x1b[1mpilot scope \"<goal>\"\x1b[0m to start a new workflow.\n");

    process.exit(0);
  },
});
