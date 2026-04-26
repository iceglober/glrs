import { command } from "cmd-ts";
import { gitRoot } from "../lib/git.js";
import { ok, bold } from "../lib/fmt.js";

export const root = command({
  name: "root",
  description: "Print the main repo root path (useful from inside a worktree)",
  args: {},
  handler: () => {
    const rootPath = gitRoot();
    ok(`repo root: ${bold(rootPath)}`);
    console.log(rootPath);
  },
});
