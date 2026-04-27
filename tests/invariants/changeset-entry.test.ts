/**
 * Invariant: the deprecation changeset exists, bumps harness-opencode as major,
 * and no changeset entries exist for assume or agentic packages.
 * Acceptance criterion a6.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(start: string): string {
  let dir = start;
  while (true) {
    try {
      readFileSync(resolve(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error("Could not find repo root");
      dir = parent;
    }
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

// Enumerate .changeset/*.md files excluding README.md
const changesetDir = resolve(repoRoot, ".changeset");
const changesetFiles = readdirSync(changesetDir).filter(
  (f) => f.endsWith(".md") && f !== "README.md",
);

// Extract frontmatter from a changeset file
function extractFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1]! : "";
}

describe("changeset entry", () => {
  test("exactly one new changeset exists", () => {
    // All other changesets (agentic-first-glrs-release, assume-first-glrs-release,
    // cli-initial-release, monorepo-migration-harness-opencode) have been removed.
    // Only the deprecation changeset remains.
    expect(changesetFiles).toHaveLength(1);
    expect(changesetFiles[0]).toBe("deprecate-standalone-bins.md");
  });

  test("changeset bumps harness-opencode as major", () => {
    const content = readFileSync(
      resolve(changesetDir, "deprecate-standalone-bins.md"),
      "utf8",
    );
    expect(content).toContain('"@glrs-dev/harness-opencode": major');
  });

  test("changeset does not mention assume, agentic, or cli", () => {
    const content = readFileSync(
      resolve(changesetDir, "deprecate-standalone-bins.md"),
      "utf8",
    );
    const frontmatter = extractFrontmatter(content);
    expect(frontmatter).not.toContain("@glrs-dev/assume");
    expect(frontmatter).not.toContain("@glrs-dev/agentic");
    expect(frontmatter).not.toContain("@glrs-dev/cli");
  });
});
