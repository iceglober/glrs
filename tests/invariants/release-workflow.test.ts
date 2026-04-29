/**
 * Invariant: release.yml has the expected structure for the assume release pipeline.
 * - Three jobs: version-or-check, build-rust, publish
 * - build-rust calls rust-build-matrix.yml via workflow_call
 * - publish downloads artifacts, runs pack:platforms, then changeset publish
 * - dry_run workflow_dispatch input sets NPM_CONFIG_DRY_RUN
 * Acceptance criterion a6.
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

const releaseYml = readFileSync(
  resolve(repoRoot, ".github/workflows/release.yml"),
  "utf8",
);
const rustMatrixYml = readFileSync(
  resolve(repoRoot, ".github/workflows/rust-build-matrix.yml"),
  "utf8",
);

describe("release workflow", () => {
  test("has version-or-check, build-rust, and publish jobs", () => {
    // Check for the three job definitions
    expect(releaseYml).toContain("jobs:");
    expect(releaseYml).toContain("version-or-check:");
    expect(releaseYml).toContain("build-rust:");
    expect(releaseYml).toContain("publish:");
  });

  test("build-rust calls rust-build-matrix.yml via workflow_call with a version input", () => {
    // Check that build-rust uses the reusable workflow
    expect(releaseYml).toContain("uses: ./.github/workflows/rust-build-matrix.yml");
    // Check that it passes the version input, sourced from version-or-check's assume_version
    // output (with an optional fallback for the dry-run path).
    expect(releaseYml).toMatch(/version:\s*\$\{\{[^}]*needs\.version-or-check\.outputs\.assume_version[^}]*\}\}/);
  });

  test("publish job downloads all assume-*-<version> artifacts before running pack:platforms", () => {
    // Check for download-artifact step
    expect(releaseYml).toContain("actions/download-artifact@v4");
    // Check for the pattern that matches all assume artifacts
    expect(releaseYml).toMatch(/pattern:\s*assume-\*-\$\{\{/);
    // Check that path is set to the expected location
    expect(releaseYml).toContain("packages/assume/.release-artifacts/");
  });

  test("publish job runs pack:platforms before changeset publish", () => {
    // Check for pack:platforms step
    expect(releaseYml).toContain("pack:platforms");
    // Check for changeset publish step
    expect(releaseYml).toContain("changeset publish");
    // Verify pack:platforms appears before changeset publish (by line position)
    const packIndex = releaseYml.indexOf("pack:platforms");
    const publishIndex = releaseYml.indexOf("changeset publish");
    expect(packIndex).toBeGreaterThan(0);
    expect(publishIndex).toBeGreaterThan(packIndex);
  });

  test("dry_run workflow_dispatch input sets NPM_CONFIG_DRY_RUN=true on the publish step", () => {
    // Check for workflow_dispatch trigger with dry_run input
    expect(releaseYml).toContain("workflow_dispatch:");
    expect(releaseYml).toContain("dry_run:");
    // Check that NPM_CONFIG_DRY_RUN is set based on the input
    expect(releaseYml).toContain("NPM_CONFIG_DRY_RUN:");
    expect(releaseYml).toContain("github.event.inputs.dry_run");
  });

  test("dry_run path bypasses the version-or-check gate", () => {
    // The dry-run flow must be able to reach build-rust + publish on a
    // feature branch that still has pending changesets. Guard against
    // regressions where a refactor re-adds the hasChangesets gate without
    // a dry-run bypass.
    expect(releaseYml).toContain("dry-run-version:");
    // dry-run-version must output assume_version (consumed by build-rust).
    expect(releaseYml).toMatch(/dry-run-version:[\s\S]*?outputs:[\s\S]*?assume_version:/);
    // build-rust's `if` must admit either a no-changesets push OR a successful dry-run-version job.
    expect(releaseYml).toMatch(/build-rust:[\s\S]*?if:[\s\S]*?dry-run-version\.result == 'success'/);
  });

  test("rust-build-matrix.yml still declares workflow_call", () => {
    expect(rustMatrixYml).toContain("workflow_call:");
  });

  test("rust-build-matrix.yml still includes all five rust targets", () => {
    expect(rustMatrixYml).toContain("x86_64-apple-darwin");
    expect(rustMatrixYml).toContain("aarch64-apple-darwin");
    expect(rustMatrixYml).toContain("x86_64-unknown-linux-gnu");
    expect(rustMatrixYml).toContain("aarch64-unknown-linux-gnu");
    expect(rustMatrixYml).toContain("x86_64-pc-windows-msvc");
  });
});
