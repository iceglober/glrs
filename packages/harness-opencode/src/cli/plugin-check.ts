/**
 * Shared helpers for checking whether the plugin is registered in
 * the user's opencode.json plugin array.
 *
 * Used by:
 *   - `doctor` (health check)
 *   - `install-plugin` / `install` (idempotent entry point)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { select, checkbox, confirm } from "@inquirer/prompts";

const PLUGIN_NAME = "@glrs-dev/harness-plugin-opencode";

export function getOpencodeConfigPath(): string {
  const configHome =
    process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode", "opencode.json");
}

/**
 * Returns true if the plugin is present in the opencode.json plugin array.
 * Returns false if the config doesn't exist, has no plugin array, or
 * the plugin isn't listed.
 */
export function isPluginInstalled(): boolean {
  const configPath = getOpencodeConfigPath();
  if (!fs.existsSync(configPath)) return false;

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const plugins: unknown[] = Array.isArray(config.plugin) ? config.plugin : [];
    return plugins.some((p) => {
      const name = typeof p === "string" ? p : Array.isArray(p) ? p[0] : null;
      return name === PLUGIN_NAME || String(name ?? "").startsWith(`${PLUGIN_NAME}@`);
    });
  } catch {
    return false;
  }
}

/**
 * Interactive prompt: ask the user a yes/no question.
 * Returns true for "yes", false otherwise.
 * Non-interactive terminals (no TTY) return `false` immediately.
 */
export async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  return confirm({ message: question, default: false });
}

/**
 * Interactive prompt: present choices with arrow-key selection, return the
 * selected index. Returns `defaultIndex` for non-TTY.
 */
export async function promptChoice(
  question: string,
  choices: string[],
  defaultIndex = 0,
): Promise<number> {
  if (!process.stdin.isTTY) return defaultIndex;

  const answer = await select({
    message: question,
    choices: choices.map((label, i) => ({
      name: label,
      value: i,
    })),
    default: defaultIndex,
  });

  return answer;
}

/**
 * Interactive prompt: present a list of checkboxes, return selected indices.
 * Non-TTY returns the default-on items.
 */
export async function promptMulti(
  question: string,
  choices: { label: string; defaultOn: boolean }[],
): Promise<Set<number>> {
  if (!process.stdin.isTTY) {
    const defaults = new Set<number>();
    choices.forEach((c, i) => { if (c.defaultOn) defaults.add(i); });
    return defaults;
  }

  const answers = await checkbox({
    message: question,
    choices: choices.map((c, i) => ({
      name: c.label,
      value: i,
      checked: c.defaultOn,
    })),
  });

  return new Set(answers);
}


