#!/usr/bin/env bun
/**
 * glrs — unified CLI entry point.
 *
 * Parses the first positional arg as the subcommand and dispatches.
 * Auto-updates on every invocation (rate-limited to once per hour).
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { subcommands, run } from "cmd-ts";
import { HELP_TEXT, WORKTREE_HELP_TEXT } from "./index.js";
import { create } from "./commands/create.js";
import { list } from "./commands/list.js";
import { del } from "./commands/delete.js";
import { cleanup } from "./commands/cleanup.js";
import { switchCmd } from "./commands/switch.js";
import { go } from "./commands/go.js";
import { autoUpdate } from "./lib/auto-update.js";
import { runAutopilot } from "./commands/autopilot-tui.js";

// ── Auto-update ─────────────────────────────────────────────────────────────
const updated = await autoUpdate();
if (updated) {
  const child = spawn("glrs", process.argv.slice(2), {
    stdio: "inherit",
    env: { ...process.env, GLRS_UPDATING: "1" },
  });
  child.on("exit", (code, signal) => {
    if (signal) { process.kill(process.pid, signal); return; }
    process.exit(code ?? 0);
  });
  child.on("error", () => process.exit(1));
  await new Promise(() => {});
}

const args = process.argv.slice(2);

// Top-level help / version / no-args
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-V") {
  const __dirname = path.dirname(import.meta.url.replace("file://", ""));
  const pkgPath = path.join(__dirname, "..", "package.json");
  // @ts-ignore - Bun types
  const pkg = await Bun.file(pkgPath).json();
  process.stdout.write(`glrs ${pkg.version}\n`);
  process.exit(0);
}

const sub = args[0];

// Handle worktree subcommands natively
if (sub === "wt" || sub === "worktree") {
  const wtArgs = args.slice(1);

  if (wtArgs.length === 0 || wtArgs[0] === "--help" || wtArgs[0] === "-h") {
    if (wtArgs.length === 0 && process.stdin.isTTY) {
      await go();
      process.exit(0);
    }
    process.stdout.write(WORKTREE_HELP_TEXT);
    process.exit(0);
  }

  const wt = subcommands({
    name: "wt",
    description: "Worktree management — create, list, and clean up git worktrees",
    cmds: {
      new: create,
      list,
      switch: switchCmd,
      delete: del,
      cleanup,
    },
  });

  await run(wt, wtArgs);
  process.exit(0);
}

// Handle loop subcommand
if (sub === "loop") {
  const { loopCmd } = await import("./commands/loop.js");
  await run(loopCmd, args.slice(1));
  process.exit(0);
}

// Handle autopilot subcommand
if (sub === "autopilot") {
  const { autopilotInteractiveCmd } = await import("./commands/autopilot.js");
  await run(autopilotInteractiveCmd, args.slice(1));
  process.exit(0);
}

// Handle harness subcommand
if (sub === "harness") {
  const { harnessCmd } = await import("./commands/harness.js");
  await run(harnessCmd, args.slice(1));
  process.exit(0);
}

// Handle headroom subcommand — context compression proxy
if (sub === "headroom") {
  const { headroomCmd } = await import("./commands/headroom.js");
  await headroomCmd(args.slice(1));
  process.exit(0);
}

// Handle assume subcommand — installs @glrs-dev/assume if missing, then dispatches to gsa
if (sub === "assume") {
  // Check if gsa is on PATH
  const which = Bun.spawnSync(["which", "gsa"]);
  if (which.exitCode !== 0) {
    process.stderr.write("[glrs] gsa not found — installing @glrs-dev/assume...\n");
    const install = spawn("npm", ["i", "-g", "@glrs-dev/assume"], { stdio: "inherit" });
    const installCode = await new Promise<number>((resolve) => {
      install.on("exit", (code) => resolve(code ?? 1));
      install.on("error", () => resolve(1));
    });
    if (installCode !== 0) {
      process.stderr.write("[glrs] Failed to install @glrs-dev/assume\n");
      process.exit(1);
    }
    process.stderr.write("\n");
  }

  const gsaArgs = args.slice(1);
  const child = spawn("gsa", gsaArgs, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) { process.kill(process.pid, signal); return; }
    process.exit(code ?? 0);
  });
  child.on("error", () => {
    process.stderr.write("[glrs] 'gsa' still not found after install. Check your PATH.\n");
    process.exit(1);
  });
  await new Promise(() => {});
}

// Handle upgrade subcommand
if (sub === "upgrade") {
  const { upgradeCmd } = await import("./commands/upgrade.js");
  await run(upgradeCmd, args.slice(1));
  process.exit(0);
}

// Handle dashboard subcommand
if (sub === "dashboard") {
  await runAutopilot();
  process.exit(0);
}

// Legacy alias: `glrs oc` → `glrs harness`
if (sub === "oc") {
  process.stderr.write(
    `[glrs] 'glrs oc' is deprecated. Use 'glrs harness' instead.\n` +
    `[glrs] Redirecting...\n\n`,
  );
  const { harnessCmd } = await import("./commands/harness.js");
  await run(harnessCmd, args.slice(1));
  process.exit(0);
}

// Unknown subcommand
process.stderr.write(
  `[glrs] Unknown subcommand '${sub}'. Run 'glrs --help' for usage.\n`,
);
process.exit(2);
