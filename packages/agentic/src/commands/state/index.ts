import { subcommands } from "cmd-ts";
import { stateTask, stateEpic } from "./task.js";
import { statePlan } from "./plan.js";
import { stateReview } from "./review.js";
import { qaReport } from "./qa.js";
import { stateLog } from "./log.js";

export const state = subcommands({
  name: "state",
  description: "Task state management (internal — used by skills and orchestrator)",
  cmds: {
    task: stateTask,
    epic: stateEpic,
    plan: statePlan,
    review: stateReview,
    qa: qaReport,
    log: stateLog,
  },
});
