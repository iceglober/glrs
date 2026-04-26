import { command, positional, optional, string } from "cmd-ts";
import fs from "node:fs";
import { loadRegistry, type RegistryEntry } from "../lib/registry.js";

export const wtPath = command({
  name: "path",
  description:
    "Print a worktree's absolute path. Use in shells: cd $(gs-agentic wt path <name>)",
  args: {
    name: positional({
      type: optional(string),
      displayName: "name",
      description:
        "Worktree name, or <repo>/<name>. Omit to list all worktrees as tab-separated <repo>/<name>\\t<path>.",
    }),
  },
  handler: ({ name }) => {
    const entries = loadRegistry().filter((e) => fs.existsSync(e.wtPath));

    if (!name) {
      for (const e of entries) {
        process.stdout.write(`${e.repo}/${e.branch}\t${e.wtPath}\n`);
      }
      return;
    }

    const matches = resolveMatches(entries, name);
    if (matches.length === 0) {
      process.stderr.write(`No worktree matches '${name}'\n`);
      process.exit(1);
    }
    if (matches.length > 1) {
      process.stderr.write(
        `Ambiguous '${name}' — matches:\n${matches
          .map((m) => `  ${m.repo}/${m.branch}`)
          .join("\n")}\nDisambiguate as <repo>/<name>.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${matches[0].wtPath}\n`);
  },
});

export function resolveMatches(
  entries: RegistryEntry[],
  query: string,
): RegistryEntry[] {
  const slashIdx = query.indexOf("/");
  if (slashIdx >= 0) {
    const repo = query.slice(0, slashIdx);
    const branch = query.slice(slashIdx + 1);
    return entries.filter((e) => e.repo === repo && e.branch === branch);
  }
  return entries.filter((e) => e.branch === query);
}
