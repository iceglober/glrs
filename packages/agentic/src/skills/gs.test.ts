import { describe, test, expect } from "bun:test";
import { gs } from "./gs.js";
import { COMMANDS } from "./index.js";
import { TASK_PREAMBLE } from "./preamble.js";

describe("gs", () => {
  const result = gs();

  test("returns non-empty string", () => {
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("has well-formed frontmatter with description", () => {
    expect(result).toMatch(/^---\ndescription:.*\n---\n/s);
  });

  test("includes $ARGUMENTS placeholder", () => {
    expect(result).toContain("$ARGUMENTS");
  });

  test("includes full TASK_PREAMBLE", () => {
    expect(result).toContain(TASK_PREAMBLE);
  });

  test("lists all registered gs-* skills", () => {
    const gsSkills = Object.keys(COMMANDS)
      .filter((k) => k.startsWith("gs-"))
      .map((k) => "/" + k.replace(".md", ""));
    for (const skill of gsSkills) {
      expect(result).toContain(skill);
    }
  });

  test("includes status command instruction", () => {
    expect(result).toContain("gs-agentic status");
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
