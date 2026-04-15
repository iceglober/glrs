import { describe, test, expect } from "bun:test";
import { gs } from "./gs.js";
import { COMMANDS, GS_SKILL_NAMES } from "./index.js";
import { TASK_PREAMBLE } from "./preamble.js";

describe("gs", () => {
  const entry = gs();
  const result = entry["SKILL.md"];

  test("returns SkillEntry with SKILL.md key", () => {
    expect(typeof entry).toBe("object");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("has well-formed frontmatter with name and description", () => {
    expect(result).toMatch(/^---\nname:.*\ndescription:.*\n/s);
  });

  test("includes $ARGUMENTS placeholder", () => {
    expect(result).toContain("$ARGUMENTS");
  });

  test("includes full TASK_PREAMBLE", () => {
    expect(result).toContain(TASK_PREAMBLE);
  });

  test("lists all registered gs skills by canonical name", () => {
    const gsSkillSlugs = Object.values(GS_SKILL_NAMES)
      .map((entry) => "/" + entry.canonical.replace(".md", ""))
      .filter((s) => s !== "/gs"); // gs.md doesn't list itself
    expect(gsSkillSlugs.length).toBeGreaterThan(0);
    for (const slug of gsSkillSlugs) {
      expect(result).toContain(slug);
    }
  });

  test("includes status command instruction", () => {
    expect(result).toContain("gs-agentic status");
  });

  test("includes state commands quick-reference section", () => {
    expect(result).toContain("State commands");
    expect(result).toContain("plan sync");
    expect(result).toContain("task next");
    expect(result).toContain("--claim");
  });

  test("does not include $ARGUMENTS in frontmatter description", () => {
    const frontmatter = result.split("---")[1];
    expect(frontmatter).not.toContain("$ARGUMENTS");
  });
});

describe("gs COMMANDS registration", () => {
  test("COMMANDS includes gs.md key", () => {
    expect(Object.keys(COMMANDS)).toContain("gs.md");
  });

  test("gs.md value is non-empty string", () => {
    const value = COMMANDS["gs.md"];
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });

  test("gs.md value contains frontmatter", () => {
    expect(COMMANDS["gs.md"].startsWith("---")).toBe(true);
  });

  test("gs.md value contains $ARGUMENTS", () => {
    expect(COMMANDS["gs.md"]).toContain("$ARGUMENTS");
  });
});
