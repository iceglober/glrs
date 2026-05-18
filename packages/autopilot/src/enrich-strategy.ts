import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Load an enrichment strategy template by name from the project config
 * or bundled defaults. Searches in order:
 * 1. .glrs/plan-enrich-strategies/<name>.md in repoRoot
 * 2. bundled strategy in src/autopilot/strategies/<name>.md
 *
 * Throws an Error listing the searched paths if the strategy is not found.
 */
export function loadStrategy(repoRoot: string, name: string): string {
  const projectPath = path.join(repoRoot, ".glrs", "plan-enrich-strategies", `${name}.md`);
  if (fs.existsSync(projectPath)) {
    return fs.readFileSync(projectPath, "utf-8");
  }
  const builtinPath = path.join(__dirname, "strategies", `${name}.md`);
  if (fs.existsSync(builtinPath)) {
    return fs.readFileSync(builtinPath, "utf-8");
  }
  throw new Error(`Unknown enrichment strategy "${name}". Searched:\n  ${projectPath}\n  ${builtinPath}`);
}

/**
 * Apply a strategy template by substituting {{file}} and {{content}}
 * placeholders. Replaces all occurrences (case-sensitive).
 */
export function applyStrategy(template: string, file: string, content: string): string {
  return template.replaceAll("{{file}}", file).replaceAll("{{content}}", content);
}
