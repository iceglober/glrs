import { command, positional, string } from "cmd-ts";
import fs from "node:fs";
import { git, gitSafe, gitRoot } from "../lib/git.js";
import { worktreePath } from "../lib/config.js";
import { runHook } from "../lib/hooks.js";
import { ok, info, bold } from "../lib/fmt.js";

export const checkout = command({
  name: "checkout",
  description: "Create a worktree from an existing remote branch",
  args: {
    branch: positional({
      type: string,
      displayName: "branch",
      description: "Remote branch name to check out as a local worktree",
    }),
  },
  handler: ({ branch }) => {
    const wtPath = worktreePath(branch);

    if (fs.existsSync(wtPath)) {
      ok(`worktree already exists: ${wtPath}`);
      return;
    }

    info(`fetching origin/${branch}...`);
    git("fetch", "origin", branch, "--quiet");

    info(`creating worktree for ${bold(branch)}...`);
    // Try tracking checkout first, fall back to plain
    const tracked = gitSafe(
      "worktree",
      "add",
      "--track",
      "-b",
      branch,
      wtPath,
      `origin/${branch}`,
      "--quiet",
    );
    if (tracked === null) {
      git("worktree", "add", wtPath, branch, "--quiet");
    }

    runHook("post_create", {
      WORKTREE_DIR: wtPath,
      WORKTREE_NAME: branch,
      BASE_BRANCH: branch,
      REPO_ROOT: gitRoot(),
    });

    ok(`worktree created at ${bold(wtPath)}`);
    console.log(`\n  cd ${wtPath}\n`);
  },
});
