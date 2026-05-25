/**
 * Asserts that a changeset file exists in .changeset/ that describes
 * both autopilot fixes introduced in this PR (a4).
 *
 * The test is intentionally lightweight — it just checks that at least
 * one non-README .md file in .changeset/ mentions:
 *   - "stale spec" OR "auto-recover" (Bug 1 language)
 *   - "Reason" OR "exit code" (Bug 2 language)
 *
 * This prevents the changeset from being accidentally deleted or forgotten.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("changeset exists for cli with autopilot fixes", () => {
  it("changeset exists for cli with autopilot fixes", () => {
    // Walk up from packages/cli to find the repo root (.changeset/)
    const repoRoot = path.resolve(
      import.meta.dir,
      "..",
      "..",
      "..",
    );
    const changesetDir = path.join(repoRoot, ".changeset");

    expect(fs.existsSync(changesetDir)).toBe(true);

    const files = fs
      .readdirSync(changesetDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md");

    expect(files.length).toBeGreaterThan(0);

    // At least one changeset must mention both fix areas
    const bug1Re = /stale.?spec|auto.?recover/i;
    const bug2Re = /Reason|exit code/i;

    const matchingFile = files.find((f) => {
      const content = fs.readFileSync(path.join(changesetDir, f), "utf-8");
      return bug1Re.test(content) && bug2Re.test(content);
    });

    expect(matchingFile).toBeDefined();
  });
});
