import readline from "node:readline";
import { command, positional, flag, optional, string } from "cmd-ts";
import { gitIn, gitInSafe, gitRoot, listWorktrees } from "../lib/git.js";
import { worktreePath } from "../lib/config.js";
import {
  loadRegistry,
  unregisterWorktree,
  type RegistryEntry,
} from "../lib/registry.js";
import { multiSelect, type Group } from "../lib/select.js";
import { ok, warn, bold, dim, red } from "../lib/fmt.js";

export const del = command({
  name: "delete",
  aliases: ["rm"],
  description: "Remove worktrees and their branches",
  args: {
    name: positional({
      type: optional(string),
      displayName: "name",
      description: "Worktree name. Omit for interactive multi-select.",
    }),
    force: flag({
      long: "force",
      short: "f",
      description: "Remove even if there are uncommitted changes",
    }),
  },
  handler: async ({ name, force }) => {
    if (!name) {
      await interactiveDelete();
      return;
    }

    // Try registry first (works from anywhere)
    const registry = loadRegistry();
    const match = registry.find((e) => e.branch === name);

    if (match) {
      removeWorktree(match.repoPath, match.wtPath, match.branch, force);
      unregisterWorktree(match.wtPath);
      return;
    }

    // Fall back to repo-local resolution
    let wtPath: string;
    try {
      wtPath = worktreePath(name);
    } catch {
      throw new Error(`Worktree '${name}' not found`);
    }

    const entries = listWorktrees();
    const entry = entries.find((e) => e.path === wtPath);
    if (!entry) {
      throw new Error(`Worktree '${name}' not found at ${wtPath}`);
    }

    removeWorktree(gitRoot(), wtPath, name, force);
    unregisterWorktree(wtPath);
  },
});

function removeWorktree(
  repoPath: string,
  wtPath: string,
  branch: string,
  force: boolean,
): void {
  if (force) {
    gitIn(repoPath, "worktree", "remove", "--force", wtPath);
  } else {
    try {
      gitIn(repoPath, "worktree", "remove", wtPath);
    } catch {
      throw new Error(
        "Worktree has uncommitted changes. Use --force to override.",
      );
    }
  }
  gitInSafe(repoPath, "branch", "-d", branch);
  ok(`deleted worktree ${bold(branch)}`);
}

async function interactiveDelete(): Promise<void> {
  const entries = loadRegistry();
  if (entries.length === 0) {
    warn("no worktrees registered");
    return;
  }

  const byRepo = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    const list = byRepo.get(entry.repo) ?? [];
    list.push(entry);
    byRepo.set(entry.repo, list);
  }

  const groups: Group<RegistryEntry>[] = [];
  for (const [repo, repoEntries] of byRepo) {
    groups.push({
      title: repo,
      choices: repoEntries.map((e) => ({
        label: e.branch,
        value: e,
        hint: e.wtPath,
      })),
    });
  }

  const selected = await multiSelect({
    message: "Select worktrees to delete",
    groups,
  });

  if (selected.length === 0) return;

  console.log();
  for (const entry of selected) {
    console.log(`  ${red("\u2715")} ${entry.branch}  ${dim(entry.wtPath)}`);
  }
  console.log();

  const confirmed = await confirm(
    `Delete ${selected.length} worktree(s)? [y/N] `,
  );
  if (!confirmed) return;

  for (const entry of selected) {
    try {
      gitIn(entry.repoPath, "worktree", "remove", entry.wtPath);
      gitInSafe(entry.repoPath, "branch", "-d", entry.branch);
      unregisterWorktree(entry.wtPath);
      ok(`deleted ${entry.branch}`);
    } catch {
      warn(`failed to delete ${entry.branch} — may have uncommitted changes`);
    }
  }
}

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
