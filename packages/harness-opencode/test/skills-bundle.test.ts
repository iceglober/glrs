import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const DIST_SKILLS = path.join(import.meta.dir, "..", "dist", "skills");
const SRC_SKILLS = path.join(import.meta.dir, "..", "src", "skills");

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

function findSkillMds(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillMds(full));
    } else if (entry.name === "SKILL.md") {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = content.slice(4, end);
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  const flush = () => {
    if (currentKey) result[currentKey] = currentValue.join(" ").trim();
  };

  for (const line of block.split("\n")) {
    if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      currentValue.push(line.trim());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) { flush(); currentKey = null; currentValue = []; continue; }
    flush();
    currentKey = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    currentValue = value ? [value] : [];
  }
  flush();
  return result;
}

const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("skills bundle", () => {
  it("dist/skills/ exists after build", () => {
    expect(fs.existsSync(DIST_SKILLS)).toBe(true);
  });

  it("has exactly 10 skill directories", () => {
    const dirs = fs.readdirSync(DIST_SKILLS, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(dirs.sort()).toEqual([
      "agent-estimation",
      "pilot-planning",
      "research",
      "research-auto",
      "research-local",
      "research-web",
      "review-plan",
      "vercel-composition-patterns",
      "vercel-react-best-practices",
      "web-design-guidelines",
    ]);
  });

  it("vercel-composition-patterns has 11 files", () => {
    const dir = path.join(DIST_SKILLS, "vercel-composition-patterns");
    expect(countFiles(dir)).toBe(11);
  });

  it("vercel-react-best-practices has 61 files", () => {
    const dir = path.join(DIST_SKILLS, "vercel-react-best-practices");
    expect(countFiles(dir)).toBe(61);
  });

  it("pilot-planning has SKILL.md + 9 rules (10 files total)", () => {
    const dir = path.join(DIST_SKILLS, "pilot-planning");
    expect(countFiles(dir)).toBe(10);
    // Verify the rules dir contains all 9 expected files (post cwd-mode rollback).
    const ruleFiles = fs
      .readdirSync(path.join(dir, "rules"))
      .sort();
    expect(ruleFiles).toEqual([
      "dag-shape.md",
      "decomposition.md",
      "first-principles.md",
      "milestones.md",
      "qa-expectations.md",
      "self-review.md",
      "task-context.md",
      "touches-scope.md",
      "verify-design.md",
    ]);
  });

  it("decomposition.md documents plan-level sizing and multi-issue bundling", () => {
    const rule = fs.readFileSync(
      path.join(DIST_SKILLS, "pilot-planning", "rules", "decomposition.md"),
      "utf8",
    );
    expect(rule).toContain("Plan sizing");
    expect(rule.toLowerCase()).toContain("multi-issue");
    expect(rule).toContain("Disconnected");
  });

  it("SKILL.md refuse-section uses underspecified/ambiguous framing", () => {
    const skill = fs.readFileSync(
      path.join(DIST_SKILLS, "pilot-planning", "SKILL.md"),
      "utf8",
    );
    const refuseIdx = skill.indexOf("## When to refuse");
    expect(refuseIdx).toBeGreaterThan(-1);
    // Slice from the refuse heading to the next `## ` heading (or EOF).
    const afterRefuse = skill.slice(refuseIdx);
    const nextHeadingRel = afterRefuse.slice("## When to refuse".length).search(/\n## /);
    const refuseSection =
      nextHeadingRel === -1
        ? afterRefuse
        : afterRefuse.slice(0, "## When to refuse".length + nextHeadingRel);
    const lowered = refuseSection.toLowerCase();
    const hasUnderspecified =
      lowered.includes("underspecified") ||
      lowered.includes("ambiguous") ||
      lowered.includes("no concrete acceptance");
    expect(hasUnderspecified).toBe(true);
  });

  it("SKILL.md has When to bundle section before When to refuse", () => {
    const skill = fs.readFileSync(
      path.join(DIST_SKILLS, "pilot-planning", "SKILL.md"),
      "utf8",
    );
    const bundleIdx = skill.indexOf("## When to bundle");
    const refuseIdx = skill.indexOf("## When to refuse");
    expect(bundleIdx).toBeGreaterThan(-1);
    expect(refuseIdx).toBeGreaterThan(-1);
    expect(bundleIdx).toBeLessThan(refuseIdx);
  });

  it("self-review.md Q6 clarifies cascade-fail scope and drops plan-size framing", () => {
    const rule = fs.readFileSync(
      path.join(DIST_SKILLS, "pilot-planning", "rules", "self-review.md"),
      "utf8",
    );
    const lowered = rule.toLowerCase();
    // Cascade scope clarified to dependents-only.
    expect(lowered).toContain("dependents");
    // New framing about concentration of value.
    const hasConcentrate =
      lowered.includes("concentrate") || lowered.includes("concentrates");
    expect(hasConcentrate).toBe(true);
  });

  it("SKILL.md rule-7 line mentions bundle check before refuse", () => {
    const skill = fs.readFileSync(
      path.join(DIST_SKILLS, "pilot-planning", "SKILL.md"),
      "utf8",
    );
    // Find the rule-7 bullet (starts with "7. [`self-review.md`]...").
    const rule7Match = skill.match(/^7\. \[`self-review\.md`\][^\n]*$/m);
    expect(rule7Match).not.toBeNull();
    const line = rule7Match![0].toLowerCase();
    expect(line).toContain("bundle");
  });

  it("every SKILL.md has required frontmatter: name and description", () => {
    const skillMds = findSkillMds(DIST_SKILLS);
    expect(skillMds.length).toBeGreaterThan(0);

    for (const skillPath of skillMds) {
      const content = fs.readFileSync(skillPath, "utf8");
      const fm = parseFrontmatter(content);
      const dirName = path.basename(path.dirname(skillPath));

      // name is required
      expect(fm["name"]).toBeDefined();
      expect(fm["name"]!.length).toBeGreaterThan(0);

      // name matches directory name
      expect(fm["name"]).toBe(dirName);

      // name matches the regex
      expect(NAME_REGEX.test(fm["name"]!)).toBe(true);

      // description is required and 1-1024 chars
      expect(fm["description"]).toBeDefined();
      expect(fm["description"]!.length).toBeGreaterThan(0);
      expect(fm["description"]!.length).toBeLessThanOrEqual(1024);
    }
  });

  it("src/skills/ SKILL.md files also have valid frontmatter (pre-build check)", () => {
    const skillMds = findSkillMds(SRC_SKILLS);
    expect(skillMds.length).toBeGreaterThan(0);

    for (const skillPath of skillMds) {
      const content = fs.readFileSync(skillPath, "utf8");
      const fm = parseFrontmatter(content);
      const dirName = path.basename(path.dirname(skillPath));

      expect(fm["name"]).toBeDefined();
      expect(fm["name"]).toBe(dirName);
      expect(NAME_REGEX.test(fm["name"]!)).toBe(true);
      expect(fm["description"]).toBeDefined();
      expect(fm["description"]!.length).toBeGreaterThan(0);
    }
  });
});
