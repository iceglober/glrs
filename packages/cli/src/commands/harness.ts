/**
 * `glrs harness` — Harness management subcommands.
 *
 * Manages agent harness plugins for supported coding tools. Each target
 * has its own install/configure/uninstall/doctor implementation.
 *
 * Supported targets:
 *   - opencode (default) — @glrs-dev/harness-plugin-opencode
 *
 * Future targets: claude-code, gemini-cli, codex-cli, cursor-cli
 */

import { command, flag, option, optional, string as stringType, subcommands, oneOf } from "cmd-ts";

const TARGETS = ["opencode"] as const;
type Target = (typeof TARGETS)[number];
const DEFAULT_TARGET: Target = "opencode";

const targetOption = option({
  long: "target",
  short: "t",
  type: optional(oneOf(TARGETS as unknown as string[])),
  description: `Target coding tool (default: ${DEFAULT_TARGET}). Available: ${TARGETS.join(", ")}`,
});

async function resolveTarget(target: string | undefined): Promise<Target> {
  const resolved = (target ?? DEFAULT_TARGET) as Target;
  if (!TARGETS.includes(resolved)) {
    process.stderr.write(
      `[glrs harness] Unknown target '${resolved}'. Available: ${TARGETS.join(", ")}\n`,
    );
    process.exit(2);
  }
  return resolved;
}

const installCmd = command({
  name: "install",
  description:
    "Install and configure the agent harness for a target coding tool.",
  args: {
    target: targetOption,
    dryRun: flag({
      long: "dry-run",
      description: "Preview changes without writing.",
    }),
    pin: flag({
      long: "pin",
      description: "Pin to the current exact version.",
    }),
  },
  handler: async ({ target, dryRun, pin }) => {
    const resolved = await resolveTarget(target);
    switch (resolved) {
      case "opencode": {
        const { install } = await import("@glrs-dev/harness-plugin-opencode/cli");
        await install({ dryRun, pin });
        break;
      }
      default: {
        const _: never = resolved;
        throw new Error(`Unimplemented target: ${_ as string}`);
      }
    }
  },
});

const configureCmd = command({
  name: "configure",
  description:
    "Interactively reconfigure models, MCPs, and plugin add-ons.",
  args: {
    target: targetOption,
  },
  handler: async ({ target }) => {
    const resolved = await resolveTarget(target);
    switch (resolved) {
      case "opencode": {
        const mod = await import("@glrs-dev/harness-plugin-opencode/cli");
        const { run } = await import("cmd-ts");
        await run(mod.configureCmd, []);
        break;
      }
      default: {
        const _: never = resolved;
        throw new Error(`Unimplemented target: ${_ as string}`);
      }
    }
  },
});

const uninstallCmd = command({
  name: "uninstall",
  description:
    "Remove the agent harness plugin from the target tool's config.",
  args: {
    target: targetOption,
    dryRun: flag({
      long: "dry-run",
      description: "Preview changes without writing.",
    }),
  },
  handler: async ({ target, dryRun }) => {
    const resolved = await resolveTarget(target);
    switch (resolved) {
      case "opencode": {
        const { uninstall } = await import("@glrs-dev/harness-plugin-opencode/cli");
        uninstall({ dryRun });
        break;
      }
      default: {
        const _: never = resolved;
        throw new Error(`Unimplemented target: ${_ as string}`);
      }
    }
  },
});

const doctorCmd = command({
  name: "doctor",
  description:
    "Check installation health for the target coding tool.",
  args: {
    target: targetOption,
  },
  handler: async ({ target }) => {
    const resolved = await resolveTarget(target);
    switch (resolved) {
      case "opencode": {
        const { doctor } = await import("@glrs-dev/harness-plugin-opencode/cli");
        doctor();
        break;
      }
      default: {
        const _: never = resolved;
        throw new Error(`Unimplemented target: ${_ as string}`);
      }
    }
  },
});

export const harnessCmd = subcommands({
  name: "harness",
  description: "Agent harness management — install, configure, uninstall, doctor.",
  cmds: {
    install: installCmd,
    configure: configureCmd,
    uninstall: uninstallCmd,
    doctor: doctorCmd,
  },
});
