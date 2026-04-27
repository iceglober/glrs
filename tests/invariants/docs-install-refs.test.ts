/**
 * Invariant: docs install pages reference only @glrs-dev/cli, not the
 * individual sub-packages.
 * Acceptance criterion a7.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
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

const DEPRECATED_INSTALLS = [
  "npm i -g @glrs-dev/harness-opencode",
  "npm i -g @glrs-dev/agentic",
  "npm i -g @glrs-dev/assume",
];

function checkMdx(relPath: string): void {
  const content = readFileSync(resolve(repoRoot, relPath), "utf8");
  expect(content, `${relPath} should contain npm i -g @glrs-dev/cli`).toContain(
    "npm i -g @glrs-dev/cli",
  );
  for (const deprecated of DEPRECATED_INSTALLS) {
    expect(content, `${relPath} should not contain '${deprecated}'`).not.toContain(deprecated);
  }
}

describe("docs install refs", () => {
  test("install.mdx installs only @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/install.mdx");
  });

  test("index.mdx installs only @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/index.mdx");
  });

  test("harness-opencode/index.mdx installs only @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/harness-opencode/index.mdx");
  });

  test("agentic/index.mdx installs only @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/agentic/index.mdx");
  });

  test("assume/index.mdx installs only @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/assume/index.mdx");
  });
});
