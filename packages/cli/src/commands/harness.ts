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

// ---- hooks init ----

import * as fs from "node:fs";
import * as path from "node:path";

const HOOK_TEMPLATES: Record<string, string> = {
  "hooks/wt_new": `#!/usr/bin/env bash
# Runs after \`glrs wt new\` creates a worktree.
# Receives: $1 = worktree directory
# Env: WORKTREE_DIR, REPO_NAME
set -euo pipefail

# Example: install dependencies in the new worktree
# cd "$1" && pnpm install
`,
  "hooks/fresh_init": `#!/usr/bin/env bash
# Runs during \`/fresh\` to reset the worktree for a new task.
# Receives env: WORKTREE_DIR, WORKTREE_NAME, OLD_BRANCH, NEW_BRANCH, BASE_BRANCH
set -euo pipefail

cd "$WORKTREE_DIR"

# Reset git state
git reset --hard HEAD
git clean -fdx

# Fetch and checkout new branch
DEFAULT_BRANCH="\${BASE_BRANCH:-main}"
git fetch origin "$DEFAULT_BRANCH" --prune
git checkout -b "$NEW_BRANCH" "origin/$DEFAULT_BRANCH"

# Example: reinstall deps, reset env
# pnpm install
# cp .env.template .env
`,
};

const EXTENSION_TEMPLATES: Record<string, string> = {
  "extensions/ship.md": `<!-- Appended to the /ship command prompt. -->
<!-- Example: wait for CI and address review feedback before merging. -->
<!-- Uncomment the lines below to activate. -->

<!-- wait for automatic code review and then address all PR feedback -->
<!-- monitor and fix any failing PR checks -->
`,
  "extensions/fresh.md": `<!-- Appended to the /fresh command prompt. -->
<!-- Example: run setup after re-keying the worktree. -->
`,
  "extensions/review.md": `<!-- Appended to the /review command prompt. -->
<!-- Example: add project-specific review criteria. -->
`,
};

const hooksInitCmd = command({
  name: "init",
  description:
    "Scaffold example .glrs/hooks/ and .glrs/extensions/ files in the current repo. Does not overwrite existing files.",
  args: {},
  handler: async () => {
    const cwd = process.cwd();
    const glrsDir = path.join(cwd, ".glrs");

    let created = 0;
    let skipped = 0;

    for (const [relPath, content] of [
      ...Object.entries(HOOK_TEMPLATES),
      ...Object.entries(EXTENSION_TEMPLATES),
    ]) {
      const fullPath = path.join(glrsDir, relPath);
      const dir = path.dirname(fullPath);

      if (fs.existsSync(fullPath)) {
        process.stdout.write(`  skip  .glrs/${relPath} (exists)\n`);
        skipped++;
        continue;
      }

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");

      if (relPath.startsWith("hooks/")) {
        fs.chmodSync(fullPath, 0o755);
      }

      process.stdout.write(`  create  .glrs/${relPath}\n`);
      created++;
    }

    process.stdout.write(
      `\n  ${created} created, ${skipped} skipped\n`,
    );
  },
});

const hooksCmd = subcommands({
  name: "hooks",
  description: "Manage repo-level hooks and extensions.",
  cmds: {
    init: hooksInitCmd,
  },
});

export const harnessCmd = subcommands({
  name: "harness",
  description: "Agent harness management — install, configure, uninstall, doctor, hooks.",
  cmds: {
    install: installCmd,
    configure: configureCmd,
    uninstall: uninstallCmd,
    doctor: doctorCmd,
    hooks: hooksCmd,
  },
});
