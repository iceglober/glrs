import { loadRegistry, type RegistryEntry } from "../lib/registry.js";
import { select, type Group } from "../lib/select.js";
import { currentBranchIn, spawnShell } from "../lib/git.js";
import { warn, info, bold, dim } from "../lib/fmt.js";

/** Interactive worktree picker — select a worktree to open a shell in. */
export async function go(): Promise<void> {
  const entries = loadRegistry();

  if (entries.length === 0) {
    warn(
      "no worktrees registered — create one with: glrs wt new",
    );
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
      choices: repoEntries.map((e) => {
        const current = currentBranchIn(e.wtPath);
        const label =
          current && current !== e.branch
            ? `${e.branch} ${dim(`→ ${current}`)}`
            : e.branch;
        return { label, value: e, hint: e.wtPath };
      }),
    });
  }

  const selected = await select({
    message: "Select a worktree",
    groups,
  });

  if (!selected) return;

  info(`opening shell in ${bold(selected.branch)}...`);
  spawnShell(selected.wtPath);
}
