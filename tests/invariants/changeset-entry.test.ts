/**
 * Invariant: changesets don't reference packages that have been removed
 * or made permanently private. Removed/forbidden packages are:
 *   - @glrs-dev/agentic (deleted from the repo)
 *   - @glrs-dev/harness-opencode (renamed to @glrs-dev/harness-plugin-opencode;
 *     the old name was deprecated at v0.16.2 on npm and must never be
 *     referenced in a new changeset)
 *   - @glrs-dev/assume* (all private; the Rust binary is published via
 *     a separate path, not via changesets)
 *
 * Valid changesets reference @glrs-dev/cli and @glrs-dev/harness-plugin-opencode
 * (the two publishable packages in the monorepo). Unrelated changes may coexist.
 *
 * This test no-ops when .changeset/ has been consumed by `changeset version`
 * (i.e., no non-README *.md files remain). That happens on the Changesets
 * "version packages" branch where the version flow has already rolled the
 * changeset content into CHANGELOG.md and package.json bumps — at which
 * point there's nothing for this test to police.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
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
const changesetDir = resolve(repoRoot, ".changeset");
const changesetFiles = readdirSync(changesetDir).filter(
  (f) => f.endsWith(".md") && f !== "README.md",
);

const allContents = changesetFiles.map((f) => ({
  name: f,
  content: readFileSync(resolve(changesetDir, f), "utf8"),
}));

function extractFrontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1]! : "";
}

// `changeset version` consumes all non-README changeset files.
// When that's happened, we have nothing to police — all assertions
// below are vacuously satisfied. Skip rather than fail.
const CONSUMED = changesetFiles.length === 0;

describe.skipIf(CONSUMED)("changeset entry", () => {
  test("no changeset references removed or forbidden packages", () => {
    // A changeset declaring these packages is dead-code and would cause
    // `changeset publish` to attempt a no-op or a failing publish.
    for (const { name, content } of allContents) {
      const frontmatter = extractFrontmatter(content);
      expect(
        frontmatter,
        `${name} should not reference @glrs-dev/agentic (deleted)`,
      ).not.toMatch(/"@glrs-dev\/agentic":\s*/);
      expect(
        frontmatter,
        `${name} should not reference @glrs-dev/harness-opencode (renamed — use @glrs-dev/harness-plugin-opencode)`,
      ).not.toMatch(/"@glrs-dev\/harness-opencode":\s*/);
      expect(
        frontmatter,
        `${name} should not reference @glrs-dev/assume or @glrs-dev/assume-<platform> (private)`,
      ).not.toMatch(/"@glrs-dev\/assume(-[a-z0-9-]+)?":\s*/);
    }
  });
});
