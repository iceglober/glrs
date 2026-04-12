import { describe, test, expect } from "bun:test";
import { gsDeepPlan } from "./gs-deep-plan.js";

describe("gsDeepPlan", () => {
  const output = gsDeepPlan();

  test("contains EnterPlanMode guardrail", () => {
    expect(output).toContain("DO NOT use the EnterPlanMode tool");
    expect(output).toContain("DO NOT enter Claude Code's plan mode");
  });

  test("lists allowed tools as positive constraint", () => {
    expect(output).toContain("Read, Grep, Glob, Bash, and Agent tools");
  });
});
