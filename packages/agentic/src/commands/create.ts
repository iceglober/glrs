import { command, positional, option, optional, string } from "cmd-ts";
import fs from "node:fs";
import { spawnShell } from "../lib/git.js";
import { info } from "../lib/fmt.js";
import { createWorktree } from "../lib/worktree.js";
import { loadRegistry } from "../lib/registry.js";
import { findRepoByScan, lookupRepo } from "../lib/repo-index.js";

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
        "Optional repo name. Required when running outside a git repo; looked up in the worktree registry, the repo index, or under repo.scan-roots.",
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
 * Locate the source repo path. Resolution order:
 *   1. No name → use current repo (createWorktree falls back to gitRoot()).
 *   2. Worktree registry (existing — fast, populated when creating worktrees).
 *   3. Repo index (~/.glorious/repos.json — populated on every gsag
 *      invocation inside a git repo).
 *   4. Scan `repo.scan-roots` (default: ~/repos, ~/code, ~/src) for a
 *      matching directory; remember the match for next time.
 */
function resolveRepoPath(repo: string | undefined): string | undefined {
  if (!repo) return undefined;

  const wt = loadRegistry().find((e) => e.repo === repo);
  if (wt) {
    if (!fs.existsSync(wt.repoPath)) {
      throw new Error(
        `Registered repo '${repo}' points to ${wt.repoPath}, which no longer exists.`,
      );
    }
    return wt.repoPath;
  }

  const indexed = lookupRepo(repo);
  if (indexed) return indexed;

  const scanned = findRepoByScan(repo);
  if (scanned) return scanned;

  throw new Error(
    `No repo named '${repo}' found.\n` +
      `  Looked in worktree registry, ~/.glorious/repos.json, and scan roots.\n` +
      `  Fix: run 'gs-agentic wt new' from inside the repo once, or add the\n` +
      `  repo's parent directory to repo.scan-roots:\n` +
      `    gs-agentic config set repo.scan-roots ~/repos:~/work`,
  );
}
