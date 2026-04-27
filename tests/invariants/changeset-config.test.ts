/**
 * Invariant: .changeset/config.json has empty linked array and docs in ignore.
 * Acceptance criterion a4.
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

describe("changeset config", () => {
  test("linked array is empty", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { linked: unknown[][] };
    expect(config.linked).toEqual([]);
  });

  test("ignore still includes @glrs-dev/docs", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, ".changeset/config.json"), "utf8"),
    ) as { ignore: string[] };
    expect(config.ignore).toContain("@glrs-dev/docs");
  });
});
