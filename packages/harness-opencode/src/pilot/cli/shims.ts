/**
 * Shims for removed pilot v1 commands.
 * Print a migration message instead of a raw "unknown command" error.
 */

import { command } from "cmd-ts";

function removedCommand(name: string, replacement: string) {
  return command({
    name,
    description: `[removed] Use \`${replacement}\` instead.`,
    args: {},
    handler: async () => {
      process.stderr.write(
        `\n\x1b[33m!\x1b[0m \`pilot ${name}\` was removed in pilot v2.\n` +
        `  Use \x1b[1m${replacement}\x1b[0m instead.\n\n` +
        `  Migration guide:\n` +
        `    pilot scope "<goal>"  — interactive scoping (replaces pilot plan)\n` +
        `    pilot go              — autonomous execution (replaces pilot build)\n` +
        `    pilot configure       — set up models and verify commands\n` +
        `    pilot status          — check workflow status\n\n`,
      );
      process.exit(1);
    },
  });
}

export const buildShim = removedCommand("build", "pilot go");
export const validateShim = removedCommand("validate", "pilot configure");
export const logsShim = removedCommand("logs", "pilot status --json");
export const costShim = removedCommand("cost", "pilot status --json");
export const buildResumeShim = removedCommand("build-resume", "pilot go");
