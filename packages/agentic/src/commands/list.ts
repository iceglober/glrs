import path from "node:path";
import { command } from "cmd-ts";
import { listWorktrees, gitRoot } from "../lib/git.js";
import { bold, dim } from "../lib/fmt.js";

export const list = command({
  name: "list",
  aliases: ["ls"],
  description: "List all worktrees",
  args: {},
  handler: () => {
    const entries = listWorktrees();
    const root = gitRoot();

    console.log(
      bold(pad("NAME", 40) + pad("BRANCH", 30) + "COMMIT"),
    );
    console.log(pad("────", 40) + pad("──────", 30) + "──────");

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
  },
});

function pad(s: string, width: number): string {
  // Account for ANSI escape codes in visible length
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return s + " ".repeat(padding);
}
