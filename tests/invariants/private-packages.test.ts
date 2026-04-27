/**
 * Invariant: all eight sub-packages are private and have no publishConfig.
 * Acceptance criterion a3.
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
  test("harness-opencode is private and has no publishConfig", () => {
    const pkg = readPkg("packages/harness-opencode/package.json");
    expect(pkg["private"]).toBe(true);
    expect(pkg["publishConfig"]).toBeUndefined();
  });

  test("assume is private and has no publishConfig", () => {
    const pkg = readPkg("packages/assume/package.json");
    expect(pkg["private"]).toBe(true);
    expect(pkg["publishConfig"]).toBeUndefined();
  });

  test("all five assume-platform packages are private", () => {
    const platforms = [
      "packages/assume/npm/darwin-arm64/package.json",
      "packages/assume/npm/darwin-x64/package.json",
      "packages/assume/npm/linux-x64/package.json",
      "packages/assume/npm/linux-arm64/package.json",
      "packages/assume/npm/win32-x64/package.json",
    ];
    for (const relPath of platforms) {
      const pkg = readPkg(relPath);
      expect(pkg["private"], `${relPath} should be private`).toBe(true);
      expect(pkg["publishConfig"], `${relPath} should have no publishConfig`).toBeUndefined();
    }
  });
});
