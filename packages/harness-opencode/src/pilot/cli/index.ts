/**
 * Pilot v2 subcommand tree.
 *
 * Commands:
 *   - scope      Start a new workflow (interactive scoping session)
 *   - go         Run the autonomous SPEAR loop (Plan → Execute → Assess → Resolve)
 *   - configure  Interactively configure pilot for this repo
 *   - status     Show workflow status
 *   - build      [removed shim — points to pilot go]
 *   - validate   [removed shim — points to pilot configure]
 *   - logs       [removed shim — points to pilot status]
 *   - cost       [removed shim — points to pilot status]
 */

import { subcommands } from "cmd-ts";
import { configureCmd } from "./configure.js";
import { scopeCmd } from "./scope.js";
import { goCmd } from "./go.js";
import { statusCmd } from "./status.js";
import { buildShim, validateShim, logsShim, costShim, buildResumeShim } from "./shims.js";

export const pilotSubcommand = subcommands({
  name: "pilot",
  description: "Pilot v2 — SPEAR-based autonomous execution (scope → plan → execute → assess → resolve).",
  cmds: {
    scope: scopeCmd,
    go: goCmd,
    configure: configureCmd,
    status: statusCmd,
    // Shims for removed v1 commands (print migration message)
    build: buildShim,
    validate: validateShim,
    logs: logsShim,
    cost: costShim,
    "build-resume": buildResumeShim,
  },
});
