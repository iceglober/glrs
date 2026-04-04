import { command, positional, option, optional, string } from "cmd-ts";
import { spawnShell } from "../lib/git.js";
import { info } from "../lib/fmt.js";
import { createWorktree } from "../lib/worktree.js";

export const create = command({
  name: "create",
  description: "Create a worktree with a new branch",
  args: {
    name: positional({
      type: string,
      displayName: "name",
      description: "Name for the new branch and worktree directory",
    }),
    from: option({
      type: optional(string),
      long: "from",
      description: "Base branch to fork from (defaults to main/master)",
    }),
  },
  handler: ({ name, from }) => {
    const { wtPath } = createWorktree(name, from);
    console.log(`\n  cd ${wtPath}\n`);

    if (process.stdin.isTTY) {
      info("spawning shell in worktree (exit to return)...");
      spawnShell(wtPath);
    }
  },
});
