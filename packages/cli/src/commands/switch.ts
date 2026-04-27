import { command } from "cmd-ts";
import { go } from "./go.js";

export const switchCmd = command({
  name: "switch",
  aliases: ["sw"],
  description: "Interactive worktree picker — select a worktree to open a shell in",
  args: {},
  handler: go,
});
