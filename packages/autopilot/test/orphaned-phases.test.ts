/**
 * Tests for findOrphanedPhaseReferences (a2).
 *
 * Covers:
 *   - returns missing wave_*.md files referenced by main.md ## Phases section
 *   - returns empty list when all referenced phases exist
 *   - returns empty list when main.md has no phase references at all
 *   - matches both wave_N.md and phase_N.md naming conventions
 *   - ignores phase files that are existing-on-disk but not referenced
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findOrphanedPhaseReferences } from "../src/plan-enrichment.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orphaned-phases-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return full;
}

describe("findOrphanedPhaseReferences", () => {
  it("returns missing wave_*.md files referenced by main.md ## Phases section", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\nDo the thing\n\n## Phases\n- [ ] wave_0.md\n- [ ] wave_1.md\n- [ ] wave_2.md\n`,
    );
    // Only wave_0.md exists on disk
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n### 0.1 Item\n- intent: Do something\n`);
    // wave_1.md and wave_2.md are absent

    const orphans = findOrphanedPhaseReferences(planDir);
    expect(orphans).toContain("wave_1.md");
    expect(orphans).toContain("wave_2.md");
    expect(orphans).not.toContain("wave_0.md");
    expect(orphans).toHaveLength(2);
  });

  it("returns empty list when all referenced phases exist", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\nDo the thing\n\n## Phases\n- [ ] wave_0.md\n- [ ] wave_1.md\n`,
    );
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n### 0.1 Item\n- intent: Do something\n`);
    writeFile(planDir, "wave_1.md", `# Wave 1\n\n### 1.1 Item\n- intent: Do something else\n`);

    const orphans = findOrphanedPhaseReferences(planDir);
    expect(orphans).toHaveLength(0);
  });

  it("returns empty list when main.md has no phase references at all", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\nDo the thing\n\n## Constraints\nKeep it simple\n`,
    );

    const orphans = findOrphanedPhaseReferences(planDir);
    expect(orphans).toHaveLength(0);
  });

  it("matches both wave_N.md and phase_N.md naming conventions", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\nDo the thing\n\n## Phases\n- [ ] wave_0.md\n- [ ] phase_1.md\n`,
    );
    // Neither file exists

    const orphans = findOrphanedPhaseReferences(planDir);
    expect(orphans).toContain("wave_0.md");
    expect(orphans).toContain("phase_1.md");
    expect(orphans).toHaveLength(2);
  });

  it("ignores phase files that are existing-on-disk but not referenced", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\nDo the thing\n\n## Phases\n- [ ] wave_0.md\n`,
    );
    writeFile(planDir, "wave_0.md", `# Wave 0\n\n### 0.1 Item\n- intent: Do something\n`);
    // wave_1.md exists on disk but is NOT referenced in main.md
    writeFile(planDir, "wave_1.md", `# Wave 1\n\n### 1.1 Item\n- intent: Extra\n`);

    const orphans = findOrphanedPhaseReferences(planDir);
    // wave_1.md is on disk but not referenced — should not appear in orphans
    expect(orphans).toHaveLength(0);
  });

  it("returns empty list when main.md is missing", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);
    // No main.md written

    const orphans = findOrphanedPhaseReferences(planDir);
    expect(orphans).toHaveLength(0);
  });

  it("detects link-form references ([wave_0.md](./wave_0.md))", () => {
    const planDir = path.join(tmpDir, "plan");
    fs.mkdirSync(planDir);

    writeFile(
      planDir,
      "main.md",
      `# My Plan\n\n## Goal\nDo the thing\n\n## Phases\n| Phase | Description |\n|-------|-------------|\n| [wave_0.md](./wave_0.md) | First wave |\n`,
    );
    // wave_0.md does not exist

    const orphans = findOrphanedPhaseReferences(planDir);
    expect(orphans).toContain("wave_0.md");
    expect(orphans).toHaveLength(1);
  });
});
