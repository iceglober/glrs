import fs from "node:fs";
import path from "node:path";
import { command } from "cmd-ts";
import { gitRoot } from "../lib/git.js";
import { ok, info } from "../lib/fmt.js";

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
