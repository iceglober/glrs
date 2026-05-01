/**
 * Invariant: root AGENTS.md reflects the new docs-site/ layout and the
 * new repo-root docs/ for shared ecosystem markdown.
 *
 * Covers acceptance criterion a9.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(start: string): string {
  let dir = start;
  while (true) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(dir, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name === "glrs") return dir;
    } catch {
      // fallthrough
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Could not find repo root");
    dir = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

describe("root AGENTS.md layout references", () => {
  test("root AGENTS.md references docs-site/", () => {
    const content = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("docs-site/");
  });

  test("root AGENTS.md references shared root docs/ for ecosystem markdown", () => {
    const content = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    // Should mention docs/ as shared ecosystem markdown (not as the Astro site)
    expect(content).toMatch(/docs\/.*[Ss]hared|[Ss]hared.*docs\//);
  });

  test("root AGENTS.md does not reference old docs/ as the site root", () => {
    const content = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    // The old line was: `├── docs/                    # Starlight → glrs.dev`
    // After the rename, docs/ should NOT be described as the Starlight site
    expect(content).not.toMatch(/├── docs\/\s+#\s+Starlight/);
  });
});
