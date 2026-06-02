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
import { track, flushAnalytics } from "./lib/analytics.js";

/** Deliver any buffered analytics, then exit. Flush is bounded and fail-silent. */
async function endRun(code: number): Promise<never> {
  await flushAnalytics();
  process.exit(code);
}

/** Subcommands we track by name. Anything else is recorded as "unknown" so we
 *  never send an arbitrary, possibly-sensitive string as a property value. */
const KNOWN_COMMANDS = new Set([
  "wt", "worktree", "loop", "autopilot", "harness", "headroom",
  "assume", "upgrade", "dashboard", "oc",
]);

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

// Usage/adoption signal: one event per invocation, command name only.
// Normalized to a known-command enum so we never emit arbitrary strings.
const first = args[0];
const commandLabel =
  args.length === 0 || first === "--help" || first === "-h" || first === "help"
    ? "help"
    : first === "--version" || first === "-V"
      ? "version"
      : first === "worktree"
        ? "wt"
        : KNOWN_COMMANDS.has(first ?? "")
          ? first!
          : "unknown";
track("command_run", { command: commandLabel });

// Top-level help / version / no-args
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  process.stdout.write(HELP_TEXT);
  await endRun(0);
}

if (args[0] === "--version" || args[0] === "-V") {
  const __dirname = path.dirname(import.meta.url.replace("file://", ""));
  const pkgPath = path.join(__dirname, "..", "package.json");
  // @ts-ignore - Bun types
  const pkg = await Bun.file(pkgPath).json();
  process.stdout.write(`glrs ${pkg.version}\n`);
  await endRun(0);
}

const sub = args[0];

// Handle worktree subcommands natively
if (sub === "wt" || sub === "worktree") {
  const wtArgs = args.slice(1);

  if (wtArgs.length === 0 || wtArgs[0] === "--help" || wtArgs[0] === "-h") {
    if (wtArgs.length === 0 && process.stdin.isTTY) {
      await go();
      await endRun(0);
    }
    process.stdout.write(WORKTREE_HELP_TEXT);
    await endRun(0);
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
  await endRun(0);
}

// Handle loop subcommand
if (sub === "loop") {
  const { loopCmd } = await import("./commands/loop.js");
  await run(loopCmd, args.slice(1));
  await endRun(0);
}

// Handle autopilot subcommand
if (sub === "autopilot") {
  const { autopilotInteractiveCmd } = await import("./commands/autopilot.js");
  await run(autopilotInteractiveCmd, args.slice(1));
  await endRun(0);
}

// Handle harness subcommand
if (sub === "harness") {
  const harnessArgs = args.slice(1);

  // Internal/dev: `glrs harness dev-preset <id> -- <command>`. Dispatched here
  // (not via cmd-ts) so it stays out of `glrs harness --help`.
  if (harnessArgs[0] === "dev-preset") {
    const { runDevPreset } = await import("./commands/harness-dev-preset.js");
    await runDevPreset(harnessArgs.slice(1));
    await endRun(0);
  }

  const { harnessCmd } = await import("./commands/harness.js");
  await run(harnessCmd, harnessArgs);
  await endRun(0);
}

// Handle headroom subcommand — context compression proxy
if (sub === "headroom") {
  const { headroomCmd } = await import("./commands/headroom.js");
  await headroomCmd(args.slice(1));
  await endRun(0);
}

// Handle assume subcommand — installs @glrs-dev/assume if missing, then dispatches to gsa
if (sub === "assume") {
  const gsaArgs = args.slice(1);

  // SSO adoption signal. Record only a known verb — never the profile/account
  // positional, which is user-supplied and could identify an org or account.
  const ASSUME_VERBS = new Set(["init", "login", "logout", "list", "exec", "console", "creds"]);
  const verb = gsaArgs[0] ?? "";
  track("assume_used", { subcommand: ASSUME_VERBS.has(verb) ? verb : "other" });

  if (gsaArgs[0] === "init") {
    // `init` is the canonical repair entry point: remove deprecated packages
    // whose stale `gsa`/`gs-assume` bins shadow the current install, then
    // install the latest version. The Rust `gsa init` then migrates legacy
    // config forward. This un-breaks machines left half-migrated by the old
    // `@glorious/assume` → `@glrs-dev/assume` rename.
    const { repairAssumeInstall } = await import("./lib/assume-install.js");
    try {
      await repairAssumeInstall();
    } catch (err) {
      process.stderr.write(String((err as Error).message) + "\n");
      process.exit(1);
    }
    process.stderr.write("\n");
  } else {
    // Other subcommands: lazy-install on first use only.
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
  }

  // Deliver the buffered event before handing the process off to gsa, which
  // takes over stdio and exits via the child's exit handler below.
  await flushAnalytics();

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
  await endRun(0);
}

// Handle dashboard subcommand
if (sub === "dashboard") {
  await runAutopilot();
  await endRun(0);
}

// Legacy alias: `glrs oc` → `glrs harness`
if (sub === "oc") {
  process.stderr.write(
    `[glrs] 'glrs oc' is deprecated. Use 'glrs harness' instead.\n` +
    `[glrs] Redirecting...\n\n`,
  );
  const { harnessCmd } = await import("./commands/harness.js");
  await run(harnessCmd, args.slice(1));
  await endRun(0);
}

// Unknown subcommand
process.stderr.write(
  `[glrs] Unknown subcommand '${sub}'. Run 'glrs --help' for usage.\n`,
);
await endRun(2);
