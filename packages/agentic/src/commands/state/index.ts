import { subcommands } from "cmd-ts";
import { stateTask } from "./task.js";
import { stateSpec } from "./spec.js";
import { qaReport } from "./qa.js";
import { stateLog } from "./log.js";

export const state = subcommands({
  name: "state",
  description: "Task state management (internal — used by skills and orchestrator)",
  cmds: {
    task: stateTask,
    spec: stateSpec,
    qa: qaReport,
    log: stateLog,
  },
});
