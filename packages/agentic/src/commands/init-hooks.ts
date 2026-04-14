import fs from "node:fs";
import path from "node:path";
import { command, flag } from "cmd-ts";
import { gitRoot } from "../lib/git.js";
import { ok, info, warn } from "../lib/fmt.js";
import {
  generateFormatterHook,
  generateSafetyHook,
  mergeHookConfigs,
  detectFormatter,
  type ClaudeHookConfig,
} from "../lib/hooks.js";

const HOOK_TEMPLATE = `#!/usr/bin/env bash
# glorious post_create hook
# Runs after a new worktree is created.
#
# Available environment variables:
#   WORKTREE_DIR  -- absolute path to the new worktree
#   WORKTREE_NAME -- name of the worktree / branch
#   BASE_BRANCH   -- branch it was created from
#   REPO_ROOT     -- absolute path to the main repository
#
# Examples:
#   cd "$WORKTREE_DIR" && bun install
#   cp "$REPO_ROOT/.env" "$WORKTREE_DIR/.env"

echo "worktree ready: $WORKTREE_DIR"
`;

export const initHooks = command({
  name: "hooks",
  description: "Create .glorious/hooks/ with a post_create template",
  args: {},
  handler: () => {
    const hookDir = path.join(gitRoot(), ".glorious", "hooks");
    fs.mkdirSync(hookDir, { recursive: true });

    const hookFile = path.join(hookDir, "post_create");
    if (fs.existsSync(hookFile)) {
      info(`hook already exists at ${hookFile}`);
      return;
    }

    fs.writeFileSync(hookFile, HOOK_TEMPLATE, { mode: 0o755 });
    ok(`created hook template at ${hookFile}`);
  },
});

/**
 * Scaffold Claude Code hooks into .claude/settings.local.json.
 * Detects project formatter and adds formatting + safety hooks.
 */
export const scaffoldClaudeHooks = command({
  name: "claude-hooks",
  description: "Scaffold Claude Code hooks for auto-formatting and safety guards",
  args: {
    safety: flag({
      long: "safety",
      description: "Include safety guards for dangerous commands (default: true)",
    }),
    noSafety: flag({
      long: "no-safety",
      description: "Skip safety guard hooks",
    }),
  },
  handler: ({ safety, noSafety }) => {
    let root: string;
    try {
      root = gitRoot();
    } catch {
      console.error("Not in a git repository");
      process.exit(1);
    }

    const configs: ClaudeHookConfig[] = [];

    // Detect formatter
    const formatter = detectFormatter(root);
    if (formatter) {
      info(`detected formatter: ${formatter}`);
      configs.push(generateFormatterHook(formatter));
    } else {
      info("no formatter detected (no .prettierrc or biome.json found)");
    }

    // Safety hooks (default: enabled unless --no-safety)
    const includeSafety = !noSafety;
    if (includeSafety) {
      configs.push(generateSafetyHook());
      info("added safety guards for dangerous commands");
    }

    if (configs.length === 0) {
      info("no hooks to configure");
      return;
    }

    const merged = mergeHookConfigs(...configs);
    const settingsPath = path.join(root, ".claude", "settings.local.json");

    // Merge with existing settings if present
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        warn("merging with existing settings.local.json");
      } catch {
        warn("existing settings.local.json is invalid — overwriting");
      }
    }

    const updated = { ...existing, ...merged };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + "\n");
    ok(`wrote hooks to ${path.relative(root, settingsPath)}`);
  },
});
