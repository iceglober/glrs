import { describe, test, expect } from "bun:test";
import { HELP_TEXT } from "./help.js";

describe("HELP_TEXT", () => {
  test("lists canonical skill names", () => {
    expect(HELP_TEXT).toContain("/think");
    expect(HELP_TEXT).toContain("/work");
    expect(HELP_TEXT).toContain("/fix");
    expect(HELP_TEXT).toContain("/qa");
    expect(HELP_TEXT).toContain("/ship");
    // Should NOT contain /gs- prefixed names
    expect(HELP_TEXT).not.toContain("/gs-think");
    expect(HELP_TEXT).not.toContain("/gs-work");
  });

  test("documents --prefix as string option", () => {
    expect(HELP_TEXT).toContain("--prefix");
    expect(HELP_TEXT).toContain("gs-");
  });

  test("shows deep-plan not plan for collision avoidance", () => {
    expect(HELP_TEXT).toContain("/deep-plan");
    expect(HELP_TEXT).toContain("/deep-review");
  });

  test("preserves non-gs skill names", () => {
    expect(HELP_TEXT).toContain("/research-auto");
    expect(HELP_TEXT).toContain("/spec-make");
  });
});
