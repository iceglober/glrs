/**
 * Dev-only harness presets (hidden from regular users).
 *
 * A preset is a named bundle of per-agent `{model, prompt}` overrides plus an
 * id used to tag telemetry. `glrs harness dev-preset <id> -- <cmd>` resolves a
 * preset, exports it as `GLRS_AGENT_OVERRIDES` (the override channel the plugin
 * already reads in config-hook) and `GLRS_DEV_PRESET` (an analytics tag the
 * cost/dispatch trackers stamp into their JSONL), then runs `<cmd>`. This lets
 * us A/B model and prompt choices per agent and later correlate them against
 * cost/speed/outcomes.
 *
 * Presets come from two layers, merged by id:
 *   1. bundled  — `src/dev-presets.json`, shipped in the package
 *   2. external — `~/.glrs/dev-presets.json` (or `$GLRS_DEV_PRESETS_FILE`), for
 *                 iterating without a republish. External wins by id and may
 *                 add new presets.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import bundled from "../dev-presets.json";
import { AGENT_NAMES } from "@glrs-dev/agent-core";

export interface AgentOverride {
  /** Fully-qualified model id, e.g. `anthropic/claude-opus-4-8`. */
  model?: string;
  /** Prompt file path, relative to the repo root (absolute paths are rejected by the plugin). */
  prompt?: string;
}

export interface DevPreset {
  id: string;
  label: string;
  description?: string;
  agents: Record<string, AgentOverride>;
}

interface PresetFile {
  presets?: DevPreset[];
}

/** Where the external override file lives (`$GLRS_DEV_PRESETS_FILE` wins). */
export function externalPresetsPath(): string {
  return (
    process.env["GLRS_DEV_PRESETS_FILE"] ??
    join(homedir(), ".glrs", "dev-presets.json")
  );
}

function parsePresetFile(raw: string, source: string): DevPreset[] {
  let data: PresetFile;
  try {
    data = JSON.parse(raw) as PresetFile;
  } catch (err) {
    throw new Error(`Invalid JSON in ${source}: ${(err as Error).message}`);
  }
  if (!Array.isArray(data.presets)) {
    throw new Error(`${source} must contain a "presets" array`);
  }
  return data.presets;
}

/**
 * Load bundled presets merged with the external file. External presets with a
 * matching id replace the bundled one; new ids are appended.
 */
export function loadDevPresets(
  externalPath: string = externalPresetsPath(),
): DevPreset[] {
  const byId = new Map<string, DevPreset>();
  for (const p of (bundled as PresetFile).presets ?? []) byId.set(p.id, p);

  if (existsSync(externalPath)) {
    for (const p of parsePresetFile(readFileSync(externalPath, "utf8"), externalPath)) {
      byId.set(p.id, p);
    }
  }
  return [...byId.values()];
}

export function resolveDevPreset(
  id: string,
  presets: DevPreset[] = loadDevPresets(),
): DevPreset | undefined {
  return presets.find((p) => p.id === id);
}

/**
 * Agent names referenced by the preset that aren't real agents. The plugin
 * silently ignores these, so surface them as a warning rather than an error.
 */
export function unknownAgents(preset: DevPreset): string[] {
  const known = new Set<string>(AGENT_NAMES as unknown as string[]);
  return Object.keys(preset.agents ?? {}).filter((name) => !known.has(name));
}

/** The `GLRS_AGENT_OVERRIDES` JSON payload for a preset. */
export function agentOverridesJson(preset: DevPreset): string {
  return JSON.stringify(preset.agents ?? {});
}
