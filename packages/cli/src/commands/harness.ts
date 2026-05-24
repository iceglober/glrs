/**
 * `glrs harness` — Harness management subcommands.
 *
 * Provides install, configure, uninstall, and doctor for the OpenCode
 * harness plugin. Delegates to handler functions exported from
 * @glrs-dev/harness-plugin-opencode/cli.
 */

import { command, flag, subcommands } from "cmd-ts";
import {
  install,
  uninstall,
  doctor,
  configureCmd,
} from "@glrs-dev/harness-plugin-opencode/cli";

const installCmd = command({
  name: "install",
  description:
    'Register @glrs-dev/harness-plugin-opencode in opencode.json and configure models/MCPs.',
  args: {
    dryRun: flag({
      long: "dry-run",
      description: "Preview changes without writing.",
    }),
    pin: flag({
      long: "pin",
      description: "Pin to the current exact version.",
    }),
  },
  handler: async ({ dryRun, pin }) => {
    await install({ dryRun, pin });
  },
});

const uninstallCmd = command({
  name: "uninstall",
  description:
    'Remove @glrs-dev/harness-plugin-opencode from opencode.json.',
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

export const harnessCmd = subcommands({
  name: "harness",
  description: "Harness plugin management — install, configure, uninstall, doctor.",
  cmds: {
    install: installCmd,
    configure: configureCmd,
    uninstall: uninstallCmd,
    doctor: doctorCmd,
  },
});
