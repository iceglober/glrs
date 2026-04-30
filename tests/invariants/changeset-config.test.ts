/**
 * Invariant: .changeset/config.json has the expected coupling between
 * cli/harness and among the assume platforms, and ignores docs.
 *
 * @glrs-dev/cli vendors @glrs-dev/harness-plugin-opencode's dist/ at build
 * time (packages/cli/scripts/vendor-harness.ts), so plugin fixes don't reach
 * users running `glrs oc install` until a CLI tarball bundles them. The two
 * packages live in Changesets' `fixed` group (NOT `linked`): `linked` only
 * aligns versions among packages that are already being bumped, so a
 * harness-only changeset would ship a new harness without republishing the
 * CLI. `fixed` guarantees every harness-plugin release forces a matching CLI
 * release at the same version, closing the drift window.
 *
 * @glrs-dev/assume and its four Unix platform siblings are in the `linked`
 * group instead — each platform always gets its own changeset anyway (via the
 * release workflow's per-platform tarball repack), so `linked` is sufficient
 * to keep their versions in lockstep. Windows (win32-x64) is not currently a
 * supported target — see rust-build-matrix.yml.
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
  test("cli and harness-plugin-opencode are in the fixed group (vendored at build time)", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { fixed?: string[][] };
    // Find the fixed group containing cli (should be exactly these two packages).
    // Order-independent so a future reorder doesn't flake the test.
    const cliGroup = (config.fixed ?? []).find((g) => g.includes("@glrs-dev/cli"));
    expect(cliGroup).toBeDefined();
    expect(new Set(cliGroup!)).toEqual(
      new Set(["@glrs-dev/cli", "@glrs-dev/harness-plugin-opencode"]),
    );
  });

  test("assume + four platform packages form a linked group", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { linked: string[][] };
    // Find the group containing assume (should be exactly these five packages:
    // main + four Unix platforms; Windows is intentionally excluded).
    const assumeGroup = config.linked.find((g) => g.includes("@glrs-dev/assume"));
    expect(assumeGroup).toBeDefined();
    expect(new Set(assumeGroup!)).toEqual(
      new Set([
        "@glrs-dev/assume",
        "@glrs-dev/assume-darwin-arm64",
        "@glrs-dev/assume-darwin-x64",
        "@glrs-dev/assume-linux-x64",
        "@glrs-dev/assume-linux-arm64",
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
