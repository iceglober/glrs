import { describe, test, expect } from "bun:test";
import { gsPlanLoop } from "./gs-plan-loop.js";

describe("gs-plan-loop skill", () => {
  const entry = gsPlanLoop();
  const content = entry["SKILL.md"];

  test("has SKILL.md key", () => {
    expect(content).toBeDefined();
  });

  test("frontmatter name is plan-loop", () => {
    expect(content).toContain("name: plan-loop");
  });

  test("has disable-model-invocation: true", () => {
    expect(content).toContain("disable-model-invocation: true");
  });

  test("references --phase understand", () => {
    expect(content).toContain("--phase understand");
  });

  test("references --claim plan-loop", () => {
    expect(content).toContain("--claim plan-loop");
  });

  test("invokes /loop", () => {
    expect(content).toContain("/loop");
  });

  test("references /research", () => {
    expect(content).toContain("/research");
  });

  test("references /deep-plan", () => {
    expect(content).toContain("/deep-plan");
  });

  test("contains autonomous preamble markers", () => {
    expect(content).toContain("autonomous");
  });

  test("does not contain AskUserQuestion or Skill Handoff Rule", () => {
    expect(content).not.toContain("AskUserQuestion");
    expect(content).not.toContain("Skill Handoff Rule");
  });
});
