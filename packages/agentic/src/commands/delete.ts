import { command, positional, flag, string } from "cmd-ts";
import { git, gitSafe, listWorktrees } from "../lib/git.js";
import { worktreePath } from "../lib/config.js";
import { ok, bold } from "../lib/fmt.js";

export const del = command({
  name: "delete",
  aliases: ["rm"],
  description: "Remove a worktree and its branch",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Worktree name (as shown in `gs-agentic wt list`)",
    }),
    force: flag({
      long: "force",
      short: "f",
      description: "Remove even if there are uncommitted changes",
    }),
  },
  handler: ({ name, force }) => {
    const wtPath = worktreePath(name);

    // Verify it exists in git's worktree list
    const entries = listWorktrees();
    const match = entries.find((e) => e.path === wtPath);
    if (!match) {
      throw new Error(`Worktree '${name}' not found at ${wtPath}`);
    }

    if (force) {
      git("worktree", "remove", "--force", wtPath);
    } else {
      try {
        git("worktree", "remove", wtPath);
      } catch {
        throw new Error(
          `Worktree has uncommitted changes. Use --force to override.`,
        );
      }
    }

    // Clean up the branch (best-effort)
    gitSafe("branch", "-d", name);

    ok(`deleted worktree ${bold(name)}`);
  },
});
