#!/usr/bin/env node
/**
 * glrs — unified CLI entry point.
 *
 * Parses the first positional arg as the subcommand, dispatches to the
 * underlying tool's binary via the resolver in ./index.ts.
 */

import { spawn } from "node:child_process";
import { HELP_TEXT, SUBCOMMANDS, resolveSubcommand, type Subcommand } from "./index.js";

const args = process.argv.slice(2);

// Top-level help / version / no-args
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-V") {
  // Read our own package version via JSON import. Avoids baking a constant at
  // build time that could drift from package.json.
  import("node:fs").then(async ({ readFileSync }) => {
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    process.stdout.write(`glrs ${pkg.version}\n`);
  });
  process.exit(0);
}

const sub = args[0];
if (!SUBCOMMANDS.includes(sub as Subcommand)) {
  process.stderr.write(
    `[glrs] Unknown subcommand '${sub}'. Run 'glrs --help' for usage.\n`,
  );
  process.exit(2);
}

let resolved;
try {
  resolved = resolveSubcommand(sub as Subcommand);
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}

const forward = args.slice(1);
const spawnArgs = [...resolved.preArgs, ...forward];

const child = spawn(resolved.executable, spawnArgs, {
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (err) => {
  process.stderr.write(`[glrs] Failed to spawn '${sub}': ${err.message}\n`);
  process.exit(127);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
