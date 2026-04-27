import * as readline from "node:readline";
import { command, option, flag, optional, string } from "cmd-ts";
import {
  git,
  gitSafe,
  gitInSafe,
  defaultBranch,
  listWorktrees,
  gitRoot,
} from "../lib/git.js";
import { isProtected } from "../lib/config.js";
import { unregisterWorktree } from "../lib/registry.js";
import { ok, info, warn, bold, dim, red } from "../lib/fmt.js";

interface Candidate {
  path: string;
  branch: string;
}

export const cleanup = command({
  name: "cleanup",
  description: "Delete worktrees whose branches are merged or stale",
  args: {
    base: option({
      type: optional(string),
      long: "base",
      description: "Base branch to check against (default: auto-detect)",
    }),
    dryRun: flag({
      long: "dry-run",
      description: "Show candidates without deleting",
    }),
    yes: flag({ long: "yes", short: "y", description: "Skip confirmation" }),
  },
  handler: async ({ base: baseOpt, dryRun, yes }) => {
    const base = baseOpt ?? defaultBranch();
    info(`checking worktrees against ${bold(base)}...`);
    gitSafe("fetch", "origin", base, "--quiet");

    const entries = listWorktrees();
    const root = gitRoot();
    const candidates: Candidate[] = [];

    for (const entry of entries) {
      // Skip main worktree
      if (entry.path === root) continue;

      const branch = entry.branch?.replace("refs/heads/", "");
      if (!branch) continue;
      if (isProtected(branch)) continue;

      // Check 1: merged into base?
      const merged =
        gitSafe(
          "merge-base",
          "--is-ancestor",
          entry.branch!,
          `origin/${base}`,
        ) !== null;

      // Check 1b: remote branch deleted?
      const remoteDeleted =
        gitSafe(
          "show-ref",
          "--verify",
          "--quiet",
          `refs/remotes/origin/${branch}`,
        ) === null;

      if (!merged && !remoteDeleted) continue;

      // Check 2: no uncommitted changes
      const status = gitInSafe(entry.path, "status", "--porcelain");
      if (status === null || status !== "") {
        if (status !== null && status !== "") {
          warn(`skipping ${branch} -- has uncommitted changes`);
        }
        continue;
      }

      // Check 3: no unpushed commits
      if (!remoteDeleted) {
        const unpushed = gitInSafe(
          entry.path,
          "log",
          "--oneline",
          `origin/${base}..HEAD`,
        );
        const count = unpushed ? unpushed.split("\n").filter(Boolean).length : 0;
        if (count > 0) {
          warn(`skipping ${branch} -- has ${count} unpushed commit(s)`);
          continue;
        }
      }

      candidates.push({ path: entry.path, branch });
    }

    if (candidates.length === 0) {
      ok("no worktrees to clean up");
      return;
    }

    console.log(`\n${bold("Candidates for cleanup:")}`);
    for (const c of candidates) {
      console.log(`  ${red("\u2715")} ${c.branch}  ${dim(`(${c.path})`)}`);
    }
    console.log();

    if (dryRun) {
      info("dry run -- no worktrees deleted");
      return;
    }

    if (!yes) {
      const confirmed = await confirm(
        `Delete ${candidates.length} worktree(s)? [y/N] `,
      );
      if (!confirmed) {
        info("aborted");
        return;
      }
    }

    for (const c of candidates) {
      try {
        git("worktree", "remove", c.path);
        gitSafe("branch", "-d", c.branch);
        unregisterWorktree(c.path);
        ok(`deleted ${c.branch}`);
      } catch {
        warn(`failed to delete ${c.branch}`);
      }
    }
  },
});

function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^[Yy]$/.test(answer.trim()));
    });
  });
}
