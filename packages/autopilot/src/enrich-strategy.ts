import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Load an enrichment strategy template by name from the project config
 * or bundled defaults. Searches in order:
 * 1. .glrs/plan-enrich-strategies/<name>.md in repoRoot
 * 2. bundled strategy in dist/strategies/<name>.md (copied from src/strategies/<name>.md by tsup onSuccess)
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
 * Extract enrichment field names from a strategy template.
 * Matches lines like:
 *   - **fieldname**: description
 * or
 *   1. **fieldname**: description
 *
 * Falls back to the default mirror/context/conventions if no fields are found.
 */
export function extractFieldNames(strategy: string): string[] {
  const regex = /^\s*(?:-|\d+\.)\s+\*\*(\w+)\*\*:/gm;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(strategy)) !== null) {
    matches.push(match[1]);
  }
  // Fall back to defaults if no fields found
  return matches.length > 0 ? matches : ["mirror", "context", "conventions"];
}

/**
 * Apply a strategy template by substituting {{file}} and {{content}}
 * placeholders. Replaces all occurrences (case-sensitive).
 */
export function applyStrategy(template: string, file: string, content: string): string {
  return template.replaceAll("{{file}}", file).replaceAll("{{content}}", content);
}
