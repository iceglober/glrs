// Standalone-invocation redirect guard — runs before everything else,
// including argv parsing and top-level side-effects (checkForUpdate,
// autoSyncSkills, initState). Set GLRS_CLI_DISPATCHED=1 to suppress.
{
  const dispatched = process.env["GLRS_CLI_DISPATCHED"];
  if (!dispatched || dispatched === "") {
    const argv1 = process.argv[1] ?? "gs-agentic";
    const invoke = argv1.replace(/\\/g, "/").split("/").pop() ?? "gs-agentic";
    process.stderr.write(`[${invoke}] This binary is deprecated when invoked standalone.\n`);
    process.stderr.write(`[${invoke}] Install @glrs-dev/cli and use 'glrs agentic' instead:\n`);
    process.stderr.write(`[${invoke}]   npm i -g @glrs-dev/cli\n`);
    process.stderr.write(`[${invoke}]   glrs agentic <args>\n`);
    process.stderr.write(`[${invoke}] Docs: https://glrs.dev/install\n`);
    process.exit(1);
  }
}

import { subcommands, run, binary } from "cmd-ts";
import { create } from "./commands/create.js";
import { checkout } from "./commands/checkout.js";
import { list } from "./commands/list.js";
import { del } from "./commands/delete.js";
import { cleanup } from "./commands/cleanup.js";
import { go } from "./commands/go.js";
import { initHooks, scaffoldClaudeHooks } from "./commands/init-hooks.js";
import { root } from "./commands/root.js";
import { wtPath } from "./commands/path.js";
import { switchCmd } from "./commands/switch.js";
import { protect } from "./commands/protect.js";

import { upgrade } from "./commands/upgrade.js";
import { installSkills, autoSyncSkills } from "./commands/install-skills.js";
import { state } from "./commands/state/index.js";
import { status } from "./commands/status.js";
import { ready } from "./commands/ready.js";
import { plan } from "./commands/plan-review.js";
import { config } from "./commands/config.js";
import { plugin } from "./commands/plugin.js";
import { HELP_TEXT } from "./help.js";
import { VERSION } from "./lib/version.js";
import { checkForUpdate } from "./lib/update-check.js";
import { initState } from "./lib/state.js";
import { gitRoot } from "./lib/git.js";
import { rememberRepo } from "./lib/repo-index.js";
import fs from "node:fs";
import path from "node:path";

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

autoSyncSkills();

// Initialize SQLite state (safe even outside git — getRepo returns null)
try { await initState(); } catch {}

// Best-effort: if we're inside a git repo (or linked worktree), record the
// primary clone so future `wt new <repo>` invocations from elsewhere can
// resolve by name without scanning the filesystem.
// Fast-path: skip spawning git entirely when no ancestor has a `.git` entry.
if (hasGitAncestor(process.cwd())) {
  try {
    const top = gitRoot();
    rememberRepo(path.basename(top), top);
  } catch {}
}

function hasGitAncestor(start: string): boolean {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

const wt = subcommands({
  name: "wt",
  description: "Worktree management — create, list, and clean up git worktrees",
  cmds: {
    new: create,
    checkout,
    list,
    switch: switchCmd,
    delete: del,
    cleanup,
    hooks: initHooks,
    protect,
    root,
    path: wtPath,
  },
});

const cli = subcommands({
  name: "gs-agentic",
  version: VERSION,
  description: "glorious — AI-native development workflow",
  cmds: {
    wt,
    plan,
    status,
    ready,
    skills: installSkills,
    config,
    plugin,
    "claude-hooks": scaffoldClaudeHooks,
    state,
    upgrade,
  },
});

run(binary(cli), process.argv);
