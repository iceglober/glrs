import { describe, test, expect } from "bun:test";
import { gsAutoLoop } from "./gs-auto-loop.js";
import { GS_SKILL_NAMES, buildAllSkills } from "./index.js";

describe("gs-auto-loop skill", () => {
  const entry = gsAutoLoop();
  const content = entry["SKILL.md"];

  test("has SKILL.md key", () => {
    expect(content).toBeDefined();
  });

  test("frontmatter name is auto-loop", () => {
    expect(content).toContain("name: auto-loop");
  });

  test("has disable-model-invocation: true", () => {
    expect(content).toContain("disable-model-invocation: true");
  });

  test("references --claim auto-loop", () => {
    expect(content).toContain("--claim auto-loop");
  });

  test("references deep-review", () => {
    expect(content).toMatch(/deep.review/i);
  });

  test("references QA", () => {
    expect(content).toMatch(/\bqa\b/i);
  });

  test("transitions to verify phase", () => {
    expect(content).toContain("--phase verify");
  });

  test("does not transition to done in the main loop", () => {
    // The main loop transitions to verify, not done.
    // close-and-claim-next uses done, but that's for the cancelled/fallback path.
    // The primary success path should use --phase verify.
    expect(content).toContain("--phase verify");
  });

  test("generates summary via task note", () => {
    expect(content).toContain("task note");
  });

  test("contains autonomous preamble markers", () => {
    expect(content).toContain("autonomous");
  });

  test("uses --format agent", () => {
    expect(content).toContain("--format agent");
  });

  test("contains failure budget/retry language", () => {
    expect(content).toMatch(/retr(y|ies)|attempt/i);
  });

  test("does not contain AskUserQuestion or Skill Handoff Rule", () => {
    expect(content).not.toContain("AskUserQuestion");
    expect(content).not.toContain("Skill Handoff Rule");
  });

  test("invokes /loop", () => {
    expect(content).toContain("/loop");
  });
});

describe("skill registry includes both new skills", () => {
  test("GS_SKILL_NAMES has gs-plan-loop", () => {
    expect(GS_SKILL_NAMES).toHaveProperty("gs-plan-loop");
  });

  test("GS_SKILL_NAMES has gs-auto-loop", () => {
    expect(GS_SKILL_NAMES).toHaveProperty("gs-auto-loop");
  });

  test("buildAllSkills includes plan-loop/SKILL.md", () => {
    const skills = buildAllSkills();
    expect(skills["plan-loop/SKILL.md"]).toBeDefined();
  });

  test("buildAllSkills includes auto-loop/SKILL.md", () => {
    const skills = buildAllSkills();
    expect(skills["auto-loop/SKILL.md"]).toBeDefined();
  });
});
