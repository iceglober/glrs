import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { command, flag } from "cmd-ts";
import { gitSafe, git } from "../lib/git.js";
import { ok, info, warn } from "../lib/fmt.js";

const HOOK_DIR = path.join(os.homedir(), ".glorious", "git-hooks");
const HOOK_PATH = path.join(HOOK_DIR, "post-checkout");

export const POST_CHECKOUT_HOOK = `#!/usr/bin/env bash
# glorious: warn when a new worktree is nested inside another git repo.
# Installed by: gs-agentic wt protect
#
# Arguments per githooks(5): <prev-head> <new-head> <checkout-type>
#   checkout-type == 1 means branch checkout (includes 'git worktree add').
# Ignore file-level checkouts (checkout-type == 0).

if [ "\${3:-0}" != "1" ]; then exit 0; fi

wt_dir="$(pwd -P)"
parent="$(dirname "$wt_dir")"
home_real="$(cd "$HOME" && pwd -P)"

while [ "$parent" != "/" ] && [ "$parent" != "$home_real" ]; do
  if [ -e "$parent/.git" ]; then
    printf '\\n\\033[33m⚠  glorious:\\033[0m nested worktree detected\\n' >&2
    printf '   created at: %s\\n' "$wt_dir" >&2
    printf '   inside:     %s\\n' "$parent" >&2
    printf '   Create worktrees from the primary clone, not from another worktree.\\n\\n' >&2
    exit 0
  fi
  parent="$(dirname "$parent")"
done
exit 0
`;

export const protect = command({
  name: "protect",
  description:
    "Install a global git post-checkout hook that warns on nested worktree creation",
  args: {
    force: flag({
      long: "force",
      short: "f",
      description:
        "Overwrite core.hooksPath even if it's already set to another directory",
    }),
  },
  handler: ({ force }) => {
    fs.mkdirSync(HOOK_DIR, { recursive: true });
    fs.writeFileSync(HOOK_PATH, POST_CHECKOUT_HOOK, { mode: 0o755 });
    ok(`wrote hook to ${HOOK_PATH}`);

    const current = gitSafe("config", "--global", "--get", "core.hooksPath");
    if (current === HOOK_DIR) {
      info("core.hooksPath already points at glorious — nothing else to do");
      return;
    }

    if (current && !force) {
      warn(
        `core.hooksPath is already set globally to ${current}.\n` +
          `  Not overwriting. To enable the glorious hook, either:\n` +
          `    1. Symlink: ln -s ${HOOK_PATH} ${current}/post-checkout\n` +
          `    2. Append its body to ${current}/post-checkout\n` +
          `    3. Re-run with --force to replace (your existing hooks will be bypassed)`,
      );
      return;
    }

    git("config", "--global", "core.hooksPath", HOOK_DIR);
    ok(`set core.hooksPath=${HOOK_DIR} (global)`);
  },
});
