/**
 * Invariant: platform packages have correct publish configuration.
 * Acceptance criterion a2.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up from this file to find the repo root (contains root package.json with name "glrs").
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

function readPkg(relPath: string): Record<string, unknown> {
  const full = resolve(repoRoot, relPath);
  return JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
}

describe("private packages", () => {
  test("harness-plugin-opencode IS publishable (required for opencode to load the plugin at runtime)", () => {
    // Reverse invariant: this package MUST publish to npm, because
    // OpenCode resolves plugins by npm-installing them at runtime into
    // ~/.cache/opencode/packages/. If it's marked private, the plugin
    // load fails with an ETARGET error.
    const pkg = readPkg("packages/harness-opencode/package.json");
    expect(pkg["private"], "harness-plugin-opencode must NOT be private").toBeUndefined();
    expect(pkg["publishConfig"]).toMatchObject({ access: "public" });
  });

  test("assume is public with publishConfig.access=public", () => {
    const pkg = readPkg("packages/assume/package.json");
    expect(pkg["private"], "assume must NOT be private").toBeUndefined();
    expect(pkg["publishConfig"]).toMatchObject({ access: "public" });
  });

  test("all five assume-platform packages are public with publishConfig.access=public", () => {
    const platforms = [
      "packages/assume/npm/darwin-arm64/package.json",
      "packages/assume/npm/darwin-x64/package.json",
      "packages/assume/npm/linux-x64/package.json",
      "packages/assume/npm/linux-arm64/package.json",
      "packages/assume/npm/win32-x64/package.json",
    ];
    for (const relPath of platforms) {
      const pkg = readPkg(relPath);
      expect(pkg["private"], `${relPath} must NOT be private`).toBeUndefined();
      expect(pkg["publishConfig"], `${relPath} must have publishConfig.access=public`).toMatchObject({ access: "public" });
    }
  });
});
