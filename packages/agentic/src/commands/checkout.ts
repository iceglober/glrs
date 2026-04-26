import fs from "node:fs";
import path from "node:path";
import { command, positional, string } from "cmd-ts";
import { gitIn, gitInSafe, gitRoot } from "../lib/git.js";
import { worktreePath, repoName } from "../lib/config.js";
import { registerWorktree } from "../lib/registry.js";
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
    const repoPath = gitRoot();
    const repo = repoName();
    const wtPath = worktreePath(branch, repo);

    if (fs.existsSync(wtPath)) {
      ok(`worktree already exists: ${wtPath}`);
      return;
    }
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });

    info(`fetching origin/${branch}...`);
    gitIn(repoPath, "fetch", "origin", branch, "--quiet");

    info(`creating worktree for ${bold(branch)}...`);
    const tracked = gitInSafe(
      repoPath,
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
      gitIn(repoPath, "worktree", "add", wtPath, branch, "--quiet");
    }

    runHook("post_create", {
      WORKTREE_DIR: wtPath,
      WORKTREE_NAME: branch,
      BASE_BRANCH: branch,
      REPO_ROOT: repoPath,
    });

    registerWorktree({
      repo,
      repoPath,
      wtPath,
      branch,
      createdAt: new Date().toISOString(),
    });

    ok(`worktree created at ${bold(wtPath)}`);
    console.log(`\n  cd ${wtPath}\n`);
  },
});
