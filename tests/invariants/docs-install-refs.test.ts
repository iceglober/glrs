/**
 * Invariant: docs install pages promote @glrs-dev/cli as the primary entry
 * point, and don't reference packages that have been removed or rolled up.
 *
 * @glrs-dev/assume remains separately installable (it's a standalone Rust
 * binary — intentionally NOT bundled into the CLI). So "npm i -g @glrs-dev/assume"
 * is a legitimate install command, not deprecated.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
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

// Packages that have been removed or rolled into @glrs-dev/cli. Users
// should never see install commands pointing at these.
const DEPRECATED_INSTALLS = [
  "npm i -g @glrs-dev/harness-opencode",
  "npm i -g @glrs-dev/agentic",
];

function checkMdx(relPath: string): void {
  const full = resolve(repoRoot, relPath);
  if (!existsSync(full)) {
    // Files removed during cleanup are fine — skip.
    return;
  }
  const content = readFileSync(full, "utf8");
  expect(content, `${relPath} should contain npm i -g @glrs-dev/cli`).toContain(
    "npm i -g @glrs-dev/cli",
  );
  for (const deprecated of DEPRECATED_INSTALLS) {
    expect(content, `${relPath} should not contain '${deprecated}'`).not.toContain(deprecated);
  }
}

describe("docs install refs", () => {
  test("install.mdx installs @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/install.mdx");
  });

  test("index.mdx installs @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/index.mdx");
  });

  test("harness-opencode/index.mdx installs @glrs-dev/cli", () => {
    checkMdx("docs/src/content/docs/harness-opencode/index.mdx");
  });

  test("assume/index.mdx installs @glrs-dev/cli (and may also show @glrs-dev/assume)", () => {
    checkMdx("docs/src/content/docs/assume/index.mdx");
  });
});
