/**
 * Repo-local prompt extensions.
 *
 * A repo can drop `<repo>/.glrs/extensions/<name>.md` to layer its own
 * conventions onto a bundled prompt WITHOUT forking it. `<name>` is the
 * extension key and may include a subdir:
 *   - commands → `<command>` (flat: `.glrs/extensions/ship.md`)
 *   - agents   → `agents/<agent>` (`.glrs/extensions/agents/prime.md`)
 * Agents are namespaced under `agents/` so they never collide with a
 * same-named command (e.g. `research` is both) and so a repo can tell
 * one-shot command instructions from persistent agent-prompt methodology.
 * The harness appends the file's content to that command's or agent's prompt
 * under a heading that names the source, so the model can tell repo-specific
 * guidance from the shipped doctrine.
 *
 * The canonical use is keeping vendor specifics OUT of the harness: the bundled
 * prompts teach portable doctrine ("wait by arming a watcher whose wake condition
 * is the first state you'd act on"); a repo's `.glrs/extensions/agents/prime.md`
 * supplies the local fact ("our CI is GitHub Actions; `gh pr checks <pr> --watch
 * --fail-fast` wakes me on the first check failure").
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Read `<cwd>/.glrs/extensions/<name>.md` and return it as an appendable
 * Markdown block (leading blank lines + a `## Extension (from …)` heading).
 * Returns `""` when the file is absent, unreadable, or empty after trimming —
 * so callers can unconditionally do `basePrompt + readExtension(name, cwd)`.
 */
export function readExtension(name: string, cwd: string): string {
  const extPath = join(cwd, ".glrs", "extensions", `${name}.md`);
  if (!existsSync(extPath)) return "";
  try {
    const content = readFileSync(extPath, "utf8").trim();
    if (!content) return "";
    return `\n\n## Extension (from .glrs/extensions/${name}.md)\n\n${content}`;
  } catch {
    return "";
  }
}
