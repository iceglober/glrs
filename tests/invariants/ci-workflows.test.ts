/**
 * Invariant: .github/workflows/docs-deploy.yml triggers on all content
 * source paths the loader consumes, builds @glrs-dev/docs-site, and
 * rsyncs from docs-site/dist/.
 *
 * Covers acceptance criterion a8.
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

function readWorkflow(): string {
  return readFileSync(
    resolve(repoRoot, ".github/workflows/docs-deploy.yml"),
    "utf8",
  );
}

describe("docs-deploy workflow", () => {
  test("docs-deploy triggers on all content source paths", () => {
    const content = readWorkflow();
    expect(content).toContain('"docs-site/**"');
    expect(content).toContain('"docs/**"');
    expect(content).toContain('"packages/*/README.md"');
    expect(content).toContain('"packages/*/docs/**"');
  });

  test("docs-deploy filter targets @glrs-dev/docs-site", () => {
    const content = readWorkflow();
    expect(content).toContain("@glrs-dev/docs-site");
    expect(content).not.toContain("@glrs-dev/docs build");
  });

  test("docs-deploy rsync source is docs-site/dist/", () => {
    const content = readWorkflow();
    expect(content).toContain("docs-site/dist/");
    // Should not reference old docs/dist/
    expect(content).not.toContain("docs/dist/");
  });
});
