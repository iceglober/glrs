/**
 * Invariant: .changeset/config.json has the expected linked groups and
 * ignores docs.
 *
 * @glrs-dev/cli vendors @glrs-dev/harness-plugin-opencode's dist/ at build
 * time (packages/cli/scripts/vendor-harness.ts), so plugin fixes don't reach
 * users running `glrs oc install` until a CLI tarball bundles them. Linking
 * the two in Changesets' config means every harness-plugin bump forces a
 * matching CLI bump, closing that drift window.
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

describe("changeset config", () => {
  test("cli and harness-plugin-opencode are linked (vendored at build time)", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { linked: string[][] };
    // Exactly one linked group, containing exactly these two packages.
    // Order-independent so a future reorder doesn't flake the test.
    expect(config.linked).toHaveLength(1);
    expect(new Set(config.linked[0])).toEqual(
      new Set(["@glrs-dev/cli", "@glrs-dev/harness-plugin-opencode"]),
    );
  });

  test("ignore still includes @glrs-dev/docs", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { ignore: string[] };
    expect(config.ignore).toContain("@glrs-dev/docs");
  });
});
