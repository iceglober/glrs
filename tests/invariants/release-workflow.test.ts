/**
 * Invariant: release.yml no longer references rust-build machinery;
 * rust-build-matrix.yml still has workflow_call and all five targets.
 * Acceptance criterion a5.
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
  test("release.yml does not reference rust-build job", () => {
    expect(releaseYml).not.toContain("rust-build");
  });

  test("release.yml does not reference pack:platforms", () => {
    expect(releaseYml).not.toContain("pack:platforms");
  });

  test("release.yml does not reference sync:version", () => {
    expect(releaseYml).not.toContain("sync:version");
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
