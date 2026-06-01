/**
 * `glrs harness dev-preset <id> -- <command...>` — INTERNAL / dev only.
 *
 * Deliberately NOT registered in the cmd-ts `harness` subcommands map, so it
 * stays out of `glrs harness --help`. It's dispatched directly from cli.ts.
 *
 * Resolves a dev preset (see src/lib/dev-presets.ts), exports it as
 * `GLRS_AGENT_OVERRIDES` + `GLRS_DEV_PRESET`, then runs the given command with
 * that environment. Use it to A/B per-agent model/prompt choices, e.g.
 *
 *     glrs harness dev-preset 1 -- opencode
 */

import { spawn } from "node:child_process";
import {
  loadDevPresets,
  resolveDevPreset,
  unknownAgents,
  agentOverridesJson,
} from "../lib/dev-presets.js";

function printAvailable(): void {
  let presets;
  try {
    presets = loadDevPresets();
  } catch (err) {
    process.stderr.write(`[glrs] ${(err as Error).message}\n`);
    return;
  }
  process.stderr.write("Available dev presets:\n");
  for (const p of presets) {
    const desc = p.description ? ` — ${p.description}` : "";
    process.stderr.write(`  ${p.id}\t${p.label}${desc}\n`);
  }
  process.stderr.write(
    "\nUsage: glrs harness dev-preset <id> -- <command>\n" +
      "       glrs harness dev-preset 1 -- opencode\n",
  );
}

/**
 * @param argv  Everything after `dev-preset`, e.g. `["1", "--", "opencode"]`.
 */
export async function runDevPreset(argv: string[]): Promise<void> {
  // Split "<id> -- <command...>" at the first "--".
  const sep = argv.indexOf("--");
  const head = sep === -1 ? argv : argv.slice(0, sep);
  const command = sep === -1 ? [] : argv.slice(sep + 1);

  const id = head[0];
  if (id === "--help" || id === "-h" || id === "list") {
    printAvailable();
    process.exit(0);
  }
  if (!id) {
    printAvailable();
    process.exit(2);
  }

  let preset;
  try {
    preset = resolveDevPreset(id);
  } catch (err) {
    process.stderr.write(`[glrs] ${(err as Error).message}\n`);
    process.exit(1);
  }
  if (!preset) {
    process.stderr.write(`[glrs] Unknown dev preset '${id}'.\n\n`);
    printAvailable();
    process.exit(2);
  }

  if (command.length === 0) {
    process.stderr.write(
      `[glrs] No command to run.\n` +
        `       Usage: glrs harness dev-preset ${id} -- <command>  (e.g. -- opencode)\n`,
    );
    process.exit(2);
  }

  const unknown = unknownAgents(preset);
  if (unknown.length > 0) {
    process.stderr.write(
      `[glrs] Warning: preset '${id}' references unknown agents (the harness will ignore them): ${unknown.join(", ")}\n`,
    );
  }

  const overrides = agentOverridesJson(preset);
  process.stderr.write(
    `[glrs] dev-preset '${preset.id}' — ${preset.label}\n` +
      `[glrs] GLRS_DEV_PRESET=${preset.id}\n` +
      `[glrs] GLRS_AGENT_OVERRIDES=${overrides}\n\n`,
  );

  const child = spawn(command[0]!, command.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      GLRS_AGENT_OVERRIDES: overrides,
      GLRS_DEV_PRESET: preset.id,
    },
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    process.stderr.write(`[glrs] Failed to run '${command[0]}': ${err.message}\n`);
    process.exit(1);
  });
  await new Promise(() => {});
}
