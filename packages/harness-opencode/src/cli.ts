#!/usr/bin/env bun
/**
 * @glrs-dev/harness-plugin-opencode CLI entry point.
 *
 * Built on `cmd-ts` for declarative argument parsing, type-safe option
 * shapes, and consistent --help output across every subcommand. Each
 * subcommand lives in its own file under `src/cli/...` (top-level) or
 * `src/pilot/cli/...` (pilot subsystem); this file is wiring only.
 *
 * Top-level commands:
 *   - install      Add the plugin to opencode.json
 *   - uninstall    Remove the plugin from opencode.json
 *   - doctor       Check installation health

 */

// Standalone-invocation redirect guard — runs before everything else.
// When invoked directly (not via `glrs oc`), print a redirect notice and exit.
// Set GLRS_CLI_DISPATCHED=1 to suppress (done by @glrs-dev/cli's dispatcher).
{
  const dispatched = process.env["GLRS_CLI_DISPATCHED"];
  if (!dispatched || dispatched === "") {
    const argv1 = process.argv[1] ?? "harness-opencode";
    const invoke = argv1.replace(/\\/g, "/").split("/").pop() ?? "harness-opencode";
    process.stderr.write(`[${invoke}] This binary is deprecated when invoked standalone.\n`);
    process.stderr.write(`[${invoke}] Install @glrs-dev/cli and use 'glrs oc' instead:\n`);
    process.stderr.write(`[${invoke}]   npm i -g @glrs-dev/cli\n`);
    process.stderr.write(`[${invoke}]   glrs oc <args>\n`);
    process.stderr.write(`[${invoke}] Docs: https://glrs.dev/install\n`);
    process.exit(1);
  }
}
// Skip when running under Bun (which reports process.versions.bun and has
// its own ABI compatibility; our `engines.node` floor applies to raw Node).
if (!process.versions.bun) {
  const [majorStr = "0", minorStr = "0"] = (process.versions.node ?? "0.0").split(".");
  const major = Number(majorStr);
  const minor = Number(minorStr);
  if (major < 20 || (major === 20 && minor < 10)) {
    process.stderr.write(
      `harness-opencode requires Node.js >= 20.10 (you are on ${process.versions.node}).\n` +
        `Upgrade Node or run via a compatible Bun runtime. See the "engines" field in package.json.\n`,
    );
    process.exit(1);
  }
}

import {
  binary,
  command,
  flag,
  positional,
  string,
  subcommands,
  run,
} from "cmd-ts";

import { install } from "./cli/install.js";
import { uninstall } from "./cli/uninstall.js";
import { doctor } from "./cli/doctor.js";
import { configureCmd } from "./cli/configure.js";

import { startUpdateCheck } from "./cli/cli-update.js";

const VERSION = "0.1.0";

// --- Subcommand definitions ------------------------------------------------

const installCmd = command({
  name: "install",
  description:
    'Add "@glrs-dev/harness-plugin-opencode" to your opencode.json plugin array.',
  args: {
    dryRun: flag({
      long: "dry-run",
      description: "Preview changes without writing.",
    }),
    pin: flag({
      long: "pin",
      description: "Pin to the current exact version (e.g. @0.1.0).",
    }),
  },
  handler: async ({ dryRun, pin }) => {
    await install({ dryRun, pin });
  },
});

const uninstallCmd = command({
  name: "uninstall",
  description:
    'Remove "@glrs-dev/harness-plugin-opencode" from your opencode.json plugin array.',
  args: {
    dryRun: flag({
      long: "dry-run",
      description: "Preview changes without writing.",
    }),
  },
  handler: ({ dryRun }) => {
    uninstall({ dryRun });
  },
});

const doctorCmd = command({
  name: "doctor",
  description:
    "Check installation health (OpenCode CLI, plugin registration, MCP backends).",
  args: {},
  handler: () => {
    doctor();
  },
});

// --- Top-level subcommand tree --------------------------------------------

// `install-plugin` is the canonical name; `install` is kept as a backwards-
// compatible alias. Both invoke the same handler.
const installPluginCmd = command({
  name: "install-plugin",
  description:
    'Add "@glrs-dev/harness-plugin-opencode" to your opencode.json plugin array.',
  args: {
    dryRun: flag({
      long: "dry-run",
      description: "Preview changes without writing.",
    }),
    pin: flag({
      long: "pin",
      description: "Pin to the current exact version (e.g. @0.1.0).",
    }),
  },
  handler: async ({ dryRun, pin }) => {
    await install({ dryRun, pin });
  },
});

const cli = subcommands({
  name: "glrs-oc",
  description: "OpenCode agent harness CLI.",
  version: VERSION,
  cmds: {
    "install-plugin": installPluginCmd,
    install: installCmd,
    uninstall: uninstallCmd,
    configure: configureCmd,
    doctor: doctorCmd,
    // Note: `loop` and `autopilot` commands have moved to @glrs-dev/cli.
  },
});

// Start the update check immediately — the registry fetch runs concurrently
// with command parsing and execution. The returned callback prints the result
// (and spawns `bun update -g` for minor/patch) synchronously on process exit,
// so it works even when command handlers call `process.exit()` directly.
const printUpdate = startUpdateCheck();
process.on("exit", printUpdate);

// `binary(cli)` strips Node's `[node, script, ...args]` boilerplate so
// `process.argv` is rewritten to just user-supplied args before parsing.
void run(binary(cli), process.argv);

// Avoid unused-positional import warning. `positional` may be used by
// future subcommands; we keep it imported for ergonomic reuse.
void positional;
