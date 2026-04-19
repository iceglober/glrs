import path from "node:path";
import { command } from "cmd-ts";
import { gitSafe, gitInSafe, gitRoot, listWorktrees } from "../lib/git.js";
import { loadRegistry, type RegistryEntry } from "../lib/registry.js";
import { bold, dim } from "../lib/fmt.js";

export const list = command({
  name: "list",
  aliases: ["ls"],
  description: "List all worktrees across repos",
  args: {},
  handler: () => {
    const entries = loadRegistry();

    if (entries.length === 0) {
      // Fall back to local git worktrees if in a repo
      if (gitSafe("rev-parse", "--git-dir")) {
        showLocalWorktrees();
        return;
      }
      console.log(
        dim("No worktrees registered. Create one with: gs-agentic wt new"),
      );
      return;
    }

    const byRepo = new Map<string, RegistryEntry[]>();
    for (const entry of entries) {
      const list = byRepo.get(entry.repo) ?? [];
      list.push(entry);
      byRepo.set(entry.repo, list);
    }

    for (const [repo, repoEntries] of byRepo) {
      console.log(`\n${bold(repo)} ${dim(repoEntries[0].repoPath)}`);
      for (const entry of repoEntries) {
        const commit =
          gitInSafe(entry.wtPath, "rev-parse", "--short", "HEAD") ??
          dim("?");
        console.log(
          `  ${pad(entry.branch, 35)} ${pad(commit, 10)} ${dim(entry.wtPath)}`,
        );
      }
    }
    console.log();
  },
});

/** Fallback: show local git worktrees (pre-registry behavior). */
function showLocalWorktrees(): void {
  const entries = listWorktrees();
  const root = gitRoot();

  console.log(bold(pad("NAME", 40) + pad("BRANCH", 30) + "COMMIT"));
  console.log(pad("\u2500\u2500\u2500\u2500", 40) + pad("\u2500\u2500\u2500\u2500\u2500\u2500", 30) + "\u2500\u2500\u2500\u2500\u2500\u2500");

  for (const entry of entries) {
    let displayName = path.basename(entry.path);
    if (entry.path === root) {
      displayName += ` ${dim("(main)")}`;
    }
    const branch = entry.branch
      ? entry.branch.replace("refs/heads/", "")
      : "(detached)";
    const shortCommit = entry.commit.slice(0, 7);
    console.log(pad(displayName, 40) + pad(branch, 30) + shortCommit);
  }
}

function pad(s: string, width: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return s + " ".repeat(padding);
}
