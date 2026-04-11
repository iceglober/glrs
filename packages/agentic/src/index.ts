import { subcommands, run, binary } from "cmd-ts";
import { create } from "./commands/create.js";
import { checkout } from "./commands/checkout.js";
import { list } from "./commands/list.js";
import { del } from "./commands/delete.js";
import { cleanup } from "./commands/cleanup.js";
import { go } from "./commands/go.js";
import { initHooks } from "./commands/init-hooks.js";
import { root } from "./commands/root.js";

import { upgrade } from "./commands/upgrade.js";
import { installSkills } from "./commands/install-skills.js";
import { state } from "./commands/state/index.js";
import { status } from "./commands/status.js";
import { ready } from "./commands/ready.js";
import { HELP_TEXT } from "./help.js";
import { VERSION } from "./lib/version.js";
import { checkForUpdate } from "./lib/update-check.js";
import { initState } from "./lib/state.js";

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

// Bare `gs-agentic wt` → interactive worktree picker
if (args[0] === "wt" && args.length === 1) {
  await go();
  process.exit(0);
}

checkForUpdate();

// Initialize SQLite state (safe even outside git — getRepo returns null)
try { await initState(); } catch {}

const wt = subcommands({
  name: "wt",
  description: "Worktree management — create, list, and clean up git worktrees",
  cmds: {
    create,
    checkout,
    list,
    delete: del,
    cleanup,
    hooks: initHooks,
    root,
  },
});

const cli = subcommands({
  name: "gs-agentic",
  version: VERSION,
  description: "glorious — AI-native development workflow",
  cmds: {
    wt,
    status,
    ready,
    skills: installSkills,
    state,
    upgrade,
  },
});

run(binary(cli), process.argv);
