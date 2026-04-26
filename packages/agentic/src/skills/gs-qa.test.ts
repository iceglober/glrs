import { describe, test, expect } from "bun:test";
import { gsQa } from "./gs-qa.js";

describe("gsQa", () => {
  const output = gsQa()["SKILL.md"];

  test("uses REVIEW_PREAMBLE (contains review state mutations)", () => {
    expect(output).toContain("state review create");
    expect(output).toContain("state review add-item");
  });

  test("includes diff strategy", () => {
    expect(output).toContain("staged changes");
    expect(output).toContain("merge-base");
  });

  test("includes DB storage instructions for findings", () => {
    expect(output).toContain("gs-agentic state review create");
    expect(output).toContain("gs-agentic state review add-item");
  });

  test("includes review verdict pattern", () => {
    expect(output).toContain("SHIP IT");
    expect(output).toContain("NEEDS FIXES");
  });

  test("includes spec compliance pass", () => {
    expect(output.toLowerCase()).toContain("spec compliance");
  });

  test("includes fix CRITICAL step", () => {
    expect(output).toContain("Fix CRITICAL");
  });
});
