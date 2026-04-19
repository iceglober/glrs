import { command, positional, option, optional, string } from "cmd-ts";
import fs from "node:fs";
import { spawnShell } from "../lib/git.js";
import { info } from "../lib/fmt.js";
import { createWorktree } from "../lib/worktree.js";
import { loadRegistry } from "../lib/registry.js";

export const create = command({
  name: "new",
  aliases: ["create"],
  description:
    "Create a worktree from the latest origin default branch. Name is auto-generated.",
  args: {
    repo: positional({
      type: optional(string),
      displayName: "repo",
      description:
        "Optional repo name. Required when running outside a git repo; looked up in the worktree registry.",
    }),
    from: option({
      type: optional(string),
      long: "from",
      description:
        "Base branch override (default: remote default branch). Rare — prefer default.",
    }),
  },
  handler: ({ repo, from }) => {
    const repoPath = resolveRepoPath(repo);
    const { wtPath } = createWorktree({ from, repoPath, repo });
    console.log(`\n  cd ${wtPath}\n`);

    if (process.stdin.isTTY) {
      info("spawning shell in worktree (exit to return)...");
      spawnShell(wtPath);
    }
  },
});

/**
 * Locate the source repo path. If a repo name is given, look it up in the
 * registry (works from outside a git repo). Otherwise use the current repo.
 */
function resolveRepoPath(repo: string | undefined): string | undefined {
  if (!repo) return undefined; // createWorktree falls back to gitRoot()

  const entries = loadRegistry();
  const match = entries.find((e) => e.repo === repo);
  if (!match) {
    throw new Error(
      `No registered repo named '${repo}'. Run 'gs-agentic wt new' from inside the repo once to register it.`,
    );
  }
  if (!fs.existsSync(match.repoPath)) {
    throw new Error(
      `Registered repo '${repo}' points to ${match.repoPath}, which no longer exists.`,
    );
  }
  return match.repoPath;
}
