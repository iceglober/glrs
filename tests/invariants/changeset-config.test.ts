/**
 * Invariant: .changeset/config.json has the expected linked groups and
 * ignores docs.
 *
 * @glrs-dev/cli vendors @glrs-dev/harness-plugin-opencode's dist/ at build
 * time (packages/cli/scripts/vendor-harness.ts), so plugin fixes don't reach
 * users running `glrs oc install` until a CLI tarball bundles them. Linking
 * the two in Changesets' config means every harness-plugin bump forces a
 * matching CLI bump, closing that drift window.
 *
 * @glrs-dev/assume and its five platform siblings are also linked so that
 * version bumps propagate to all six packages simultaneously.
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
    // Find the group containing cli (should be exactly these two packages).
    // Order-independent so a future reorder doesn't flake the test.
    const cliGroup = config.linked.find((g) => g.includes("@glrs-dev/cli"));
    expect(cliGroup).toBeDefined();
    expect(new Set(cliGroup!)).toEqual(
      new Set(["@glrs-dev/cli", "@glrs-dev/harness-plugin-opencode"]),
    );
  });

  test("assume + five platform packages form a linked group", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { linked: string[][] };
    // Find the group containing assume (should be exactly these six packages).
    const assumeGroup = config.linked.find((g) => g.includes("@glrs-dev/assume"));
    expect(assumeGroup).toBeDefined();
    expect(new Set(assumeGroup!)).toEqual(
      new Set([
        "@glrs-dev/assume",
        "@glrs-dev/assume-darwin-arm64",
        "@glrs-dev/assume-darwin-x64",
        "@glrs-dev/assume-linux-x64",
        "@glrs-dev/assume-linux-arm64",
        "@glrs-dev/assume-win32-x64",
      ]),
    );
  });

  test("ignore still includes @glrs-dev/docs", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { ignore: string[] };
    expect(config.ignore).toContain("@glrs-dev/docs");
  });
});
