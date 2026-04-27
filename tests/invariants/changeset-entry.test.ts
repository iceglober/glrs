/**
 * Invariant: the deprecation changeset exists, bumps harness-opencode as major,
 * and no changeset entries exist for the now-private packages (assume, agentic,
 * or any @glrs-dev/assume-<platform>).
 * Acceptance criterion a6.
 *
 * Note: unrelated changesets for other still-public packages may coexist —
 * we do NOT assert a single-changeset invariant because main can legitimately
 * carry multiple in-flight changes. We only enforce the private-package
 * and deprecation invariants.
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

describe("changeset entry", () => {
  test("deprecation changeset exists", () => {
    expect(changesetFiles).toContain("deprecate-standalone-bins.md");
  });

  test("deprecation changeset bumps harness-opencode as major", () => {
    const content = readFileSync(
      resolve(changesetDir, "deprecate-standalone-bins.md"),
      "utf8",
    );
    expect(content).toContain('"@glrs-dev/harness-opencode": major');
  });

  test("deprecation changeset does not mention assume, agentic, or cli", () => {
    const content = readFileSync(
      resolve(changesetDir, "deprecate-standalone-bins.md"),
      "utf8",
    );
    const frontmatter = extractFrontmatter(content);
    expect(frontmatter).not.toContain("@glrs-dev/assume");
    expect(frontmatter).not.toContain("@glrs-dev/agentic");
    expect(frontmatter).not.toContain("@glrs-dev/cli");
  });

  test("no changeset references now-private packages (assume, agentic)", () => {
    // The packages being made private in this PR must not appear in any
    // changeset's frontmatter — changeset publish skips private packages,
    // but we enforce the cleaner invariant of not even declaring them.
    for (const { name, content } of allContents) {
      const frontmatter = extractFrontmatter(content);
      expect(
        frontmatter,
        `${name} should not reference @glrs-dev/assume or @glrs-dev/assume-<platform>`,
      ).not.toMatch(/"@glrs-dev\/assume(-[a-z0-9-]+)?":\s*/);
      expect(
        frontmatter,
        `${name} should not reference @glrs-dev/agentic`,
      ).not.toMatch(/"@glrs-dev\/agentic":\s*/);
    }
  });
});
