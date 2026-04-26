import { describe, test, expect } from "bun:test";
import { gsFix } from "./gs-fix.js";

describe("gsFix", () => {
  const output = gsFix()["SKILL.md"];

  test("includes TDD instructions (failing test first)", () => {
    expect(output).toContain("failing");
    expect(output).toContain("RED");
    expect(output).toContain("GREEN");
  });

  test("includes full verification (typecheck + test + build)", () => {
    expect(output).toContain("typecheck");
    expect(output).toContain("bun test");
    expect(output).toContain("bun run build");
  });

  test("includes structured report template", () => {
    expect(output).toContain("## Fixed");
    expect(output).toContain("Task:");
    expect(output).toContain("Tests:");
  });

  test("includes classification system (bug/scope-change/new-work)", () => {
    expect(output).toContain("Bug");
    expect(output).toContain("Scope change");
    expect(output).toContain("New work");
  });

  test("includes diff strategy", () => {
    expect(output).toContain("git diff");
    expect(output).toContain("merge-base");
  });

  test("includes TASK_PREAMBLE content", () => {
    expect(output).toContain("gs-agentic state task current");
  });
});
