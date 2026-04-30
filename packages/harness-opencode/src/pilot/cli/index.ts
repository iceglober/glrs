/**
 * Pilot subcommand tree (`bunx @glrs-dev/harness-plugin-opencode pilot ...`).
 *
 * Wired into the top-level CLI via `src/cli.ts`.
 *
 * Subcommands (cwd mode — 8 verbs):
 *   - validate      Validate a pilot.yaml against schema, DAG, globs.
 *   - plan          Spawn the opencode TUI with the pilot-planner agent.
 *   - build         Run the pilot worker against a plan (in cwd).
 *   - build-resume  Continue a partially-completed run from where it left off.
 *   - status        Print the current run's task statuses.
 *   - logs          Print events / verify outputs for a task.
 *   - cost          Print per-task and total cost for a run.
 *   - plan-dir      Print the per-repo pilot plans directory.
 */

import { subcommands } from "cmd-ts";

import { validateCmd } from "./validate.js";
import { planCmd } from "./plan.js";
import { buildCmd } from "./build.js";
import { buildResumeCmd } from "./build-resume.js";
import { statusCmd } from "./status.js";
import { logsCmd } from "./logs.js";
import { costCmd } from "./cost.js";
import { planDirCmd } from "./plan-dir.js";

export const pilotSubcommand = subcommands({
  name: "pilot",
  description:
    "Pilot subsystem — plan, validate, build, and manage unattended task runs.",
  cmds: {
    validate: validateCmd,
    plan: planCmd,
    build: buildCmd,
    "build-resume": buildResumeCmd,
    status: statusCmd,
    logs: logsCmd,
    cost: costCmd,
    "plan-dir": planDirCmd,
  },
});
