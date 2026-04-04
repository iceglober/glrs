import { subcommands, run, binary } from "cmd-ts";
import { create } from "./commands/create.js";
import { checkout } from "./commands/checkout.js";
import { list } from "./commands/list.js";
import { del } from "./commands/delete.js";
import { cleanup } from "./commands/cleanup.js";
import { initHooks } from "./commands/init-hooks.js";
import { start } from "./commands/start.js";
import { upgrade } from "./commands/upgrade.js";
import { installSkills } from "./commands/install-skills.js";
import { state } from "./commands/state/index.js";
import { status } from "./commands/status.js";
import { HELP_TEXT } from "./help.js";
import { VERSION } from "./lib/version.js";
import { checkForUpdate } from "./lib/update-check.js";

// Intercept --help / -h / no-args before cmd-ts to show our full manual
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(HELP_TEXT);
  process.exit(0);
}
if (args[0] === "--version" || args[0] === "-V") {
  console.log(`gs-agentic ${VERSION}`);
  process.exit(0);
}

checkForUpdate();

const wt = subcommands({
  name: "wt",
  description: "Worktree management — create, list, and clean up git worktrees",
  cmds: {
    create,
    checkout,
    list,
    delete: del,
    cleanup,
  },
});

const cli = subcommands({
  name: "gs-agentic",
  version: VERSION,
  description: "glorious — AI-native development workflow",
  cmds: {
    wt,
    start,
    status,
    skills: installSkills,
    hooks: initHooks,
    state,
    upgrade,
  },
});

run(binary(cli), process.argv);
