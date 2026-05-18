/**
 * Tests for the changeset-generator module (item 4.6).
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateChangeset,
  inferBumpLevel,
  readPlanTitle,
  readPlanGoal,
  slugifyTitle,
} from "../src/changeset-generator.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "changeset-gen-test-"));
}

describe("inferBumpLevel", () => {
  it("returns minor by default", () => {
    expect(inferBumpLevel("Add feature X")).toBe("minor");
    expect(inferBumpLevel("Implement something")).toBe("minor");
  });

  it("returns patch for fix/bug titles", () => {
    expect(inferBumpLevel("Fix the broken logger")).toBe("patch");
    expect(inferBumpLevel("Bug in the parser")).toBe("patch");
    expect(inferBumpLevel("Hotfix for credential refresh")).toBe("patch");
  });

  it("returns major for breaking changes", () => {
    expect(inferBumpLevel("Remove deprecated API")).toBe("major");
    expect(inferBumpLevel("Breaking changes for v2")).toBe("major");
    expect(inferBumpLevel("v2 redesign")).toBe("major");
  });

  it("major beats patch when both keywords present", () => {
    expect(inferBumpLevel("Remove buggy fix")).toBe("major");
  });
});

describe("slugifyTitle", () => {
  it("lowercases and dasherizes", () => {
    expect(slugifyTitle("Add Feature X")).toBe("add-feature-x");
  });

  it("collapses runs of non-alphanum to single dash", () => {
    expect(slugifyTitle("Foo!!  bar??  baz")).toBe("foo-bar-baz");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugifyTitle("---hello---")).toBe("hello");
  });

  it("truncates to 40 chars", () => {
    const long = "x".repeat(100);
    expect(slugifyTitle(long).length).toBeLessThanOrEqual(40);
  });

  it("falls back to autopilot for empty input", () => {
    expect(slugifyTitle("")).toBe("autopilot");
    expect(slugifyTitle("!!!")).toBe("autopilot");
  });
});

describe("readPlanTitle / readPlanGoal", () => {
  it("reads H1 from a single-file plan", () => {
    const dir = tmpDir();
    const f = path.join(dir, "plan.md");
    fs.writeFileSync(f, "# My Plan Title\n\nBody.\n");
    expect(readPlanTitle(f)).toBe("My Plan Title");
  });

  it("reads H1 from main.md in a directory plan", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "main.md"),
      "# Multi-file Plan\n\n## Goal\n\nDo the thing.\n",
    );
    expect(readPlanTitle(dir)).toBe("Multi-file Plan");
  });

  it("returns empty string when no H1 present", () => {
    const dir = tmpDir();
    const f = path.join(dir, "plan.md");
    fs.writeFileSync(f, "No heading here.\n");
    expect(readPlanTitle(f)).toBe("");
  });

  it("reads ## Goal section as the body source", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "main.md"),
      `# Plan

## Goal

Improve the autopilot's reliability.

## Constraints

- bun:test
`,
    );
    expect(readPlanGoal(dir)).toContain("Improve the autopilot");
  });

  it("falls back to title when no ## Goal section present", () => {
    const dir = tmpDir();
    const f = path.join(dir, "plan.md");
    fs.writeFileSync(f, "# Plan Title\n\nNo goal section.\n");
    expect(readPlanGoal(f)).toBe("Plan Title");
  });
});

describe("generateChangeset", () => {
  it("writes a Changesets v2 file with package + bump level", async () => {
    const repoRoot = tmpDir();
    const planDir = path.join(repoRoot, "plan");
    fs.mkdirSync(planDir);
    fs.writeFileSync(
      path.join(planDir, "main.md"),
      `# Add autopilot wave 4

## Goal

Production-grade execution quality.
`,
    );

    const result = await generateChangeset(planDir, repoRoot, {
      _randomSuffix: () => "abc123",
    });

    expect(result.bumpLevel).toBe("minor");
    expect(result.path).toBe(
      path.join(repoRoot, ".changeset", "add-autopilot-wave-4-abc123.md"),
    );
    const written = fs.readFileSync(result.path, "utf-8");
    expect(written).toContain('"@glrs-dev/harness-plugin-opencode": minor');
    expect(written).toContain("Production-grade execution quality.");
  });

  it("creates the .changeset/ directory if missing", async () => {
    const repoRoot = tmpDir();
    const f = path.join(repoRoot, "plan.md");
    fs.writeFileSync(f, "# Fix typo\n\n## Goal\n\nFix it.\n");
    expect(fs.existsSync(path.join(repoRoot, ".changeset"))).toBe(false);

    await generateChangeset(f, repoRoot, { _randomSuffix: () => "xyz789" });

    expect(fs.existsSync(path.join(repoRoot, ".changeset"))).toBe(true);
  });

  it("infers patch level for fix titles", async () => {
    const repoRoot = tmpDir();
    const f = path.join(repoRoot, "plan.md");
    fs.writeFileSync(f, "# Fix the broken thing\n\n## Goal\n\nFix it.\n");
    const result = await generateChangeset(f, repoRoot, {
      _randomSuffix: () => "p1",
    });
    expect(result.bumpLevel).toBe("patch");
    expect(result.content).toContain('": patch');
  });

  it("falls back to 'Autopilot run' when plan has no title", async () => {
    const repoRoot = tmpDir();
    const f = path.join(repoRoot, "plan.md");
    fs.writeFileSync(f, "No title at all.\n");
    const result = await generateChangeset(f, repoRoot, {
      _randomSuffix: () => "noop",
    });
    expect(result.path).toContain("autopilot-run");
  });

  it("supports a custom package name override", async () => {
    const repoRoot = tmpDir();
    const f = path.join(repoRoot, "plan.md");
    fs.writeFileSync(f, "# Add feature\n\n## Goal\n\nDo it.\n");
    const result = await generateChangeset(f, repoRoot, {
      packageName: "@glrs-dev/cli",
      _randomSuffix: () => "test",
    });
    expect(result.content).toContain('"@glrs-dev/cli": minor');
  });
});

// ---------------------------------------------------------------------------
// YAML spec path (a8)
// ---------------------------------------------------------------------------

describe("readPlanGoal / readPlanTitle — YAML spec path", () => {
  it("readPlanGoal reads from spec/main.yaml", () => {
    const dir = tmpDir();
    const specDir = path.join(dir, "spec");
    fs.mkdirSync(specDir);
    fs.writeFileSync(
      path.join(specDir, "main.yaml"),
      `title: My YAML Plan
goal: Implement the YAML-based spec system
phases: []
`,
    );
    // Also write main.md as fallback
    fs.writeFileSync(
      path.join(dir, "main.md"),
      `# My YAML Plan\n\n## Goal\n\nOld markdown goal.\n`,
    );

    const goal = readPlanGoal(dir);
    expect(goal).toContain("YAML-based spec system");
  });

  it("readPlanTitle reads from spec/main.yaml", () => {
    const dir = tmpDir();
    const specDir = path.join(dir, "spec");
    fs.mkdirSync(specDir);
    fs.writeFileSync(
      path.join(specDir, "main.yaml"),
      `title: YAML Title
phases: []
`,
    );
    // Also write main.md with different title
    fs.writeFileSync(
      path.join(dir, "main.md"),
      `# Markdown Title\n\nBody.\n`,
    );

    const title = readPlanTitle(dir);
    expect(title).toBe("YAML Title");
  });

  it("falls back to markdown when no spec/main.yaml", () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "main.md"),
      `# Markdown Fallback Title\n\n## Goal\n\nMarkdown goal.\n`,
    );

    const title = readPlanTitle(dir);
    expect(title).toBe("Markdown Fallback Title");

    const goal = readPlanGoal(dir);
    expect(goal).toContain("Markdown goal");
  });
});
