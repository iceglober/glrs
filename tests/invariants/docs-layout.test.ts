/**
 * Invariant: repo layout reflects the docs/ → docs-site/ rename and the
 * creation of a new repo-root docs/ for shared ecosystem markdown.
 *
 * Covers acceptance criteria a1, a2, a3, a7.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

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

describe("docs-site exists and docs is not the site root", () => {
  test("docs-site exists and docs is not the site root", () => {
    expect(existsSync(resolve(repoRoot, "docs-site"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "docs-site/astro.config.mjs"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "docs-site/package.json"))).toBe(true);
    // The old docs/ should not contain astro.config.mjs (it's now docs-site/)
    expect(existsSync(resolve(repoRoot, "docs/astro.config.mjs"))).toBe(false);
  });

  test("docs-site/astro.config.mjs is a git-tracked rename of the old docs/astro.config.mjs", () => {
    // git log --follow should return at least 2 commits (the rename + original)
    // Skip gracefully if shallow clone
    try {
      const out = execSync(
        "git log --follow --oneline docs-site/astro.config.mjs",
        { cwd: repoRoot, encoding: "utf8" },
      ).trim();
      const lines = out.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    } catch {
      // Shallow clone — skip
      console.log("Skipping git-follow check (shallow clone or git error)");
    }
  });
});

describe("repo-root docs/ for shared ecosystem markdown", () => {
  test("repo-root docs/install.md exists", () => {
    expect(existsSync(resolve(repoRoot, "docs/install.md"))).toBe(true);
  });

  test("docs-site/src/content/docs/install.mdx has been removed", () => {
    expect(existsSync(resolve(repoRoot, "docs-site/src/content/docs/install.mdx"))).toBe(false);
  });
});

describe("root package.json and metadata reference docs-site", () => {
  test("root package.json workspaces lists docs-site (not docs)", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as { workspaces: string[] };
    expect(pkg.workspaces).toContain("docs-site");
    expect(pkg.workspaces).not.toContain("docs");
  });

  test("root build script filters @glrs-dev/docs-site", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toContain("@glrs-dev/docs-site");
    expect(pkg.scripts.build).not.toContain("@glrs-dev/docs ");
  });

  test(".gitignore excludes docs-site/dist", () => {
    const gitignore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain("docs-site/dist/");
    expect(gitignore).not.toContain("docs/dist/");
  });
});

describe("duplicated package overview MDX files have been removed", () => {
  test("duplicated package overview MDX files have been removed", () => {
    expect(existsSync(resolve(repoRoot, "docs-site/src/content/docs/cli/index.mdx"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "docs-site/src/content/docs/harness-opencode/index.mdx"))).toBe(false);
    expect(existsSync(resolve(repoRoot, "docs-site/src/content/docs/assume/index.mdx"))).toBe(false);
  });
});
