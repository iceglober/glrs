import { describe, test, expect } from "bun:test";
import { gsDeepPlan } from "./gs-deep-plan.js";

describe("gsDeepPlan", () => {
  const output = gsDeepPlan();

  test("plan mode constraint appears before role definition", () => {
    const constraintIdx = output.indexOf("YOU MUST NEVER ENTER PLAN MODE");
    const roleIdx = output.indexOf("You are an implementation architect");
    expect(constraintIdx).toBeGreaterThan(-1);
    expect(roleIdx).toBeGreaterThan(-1);
    expect(constraintIdx).toBeLessThan(roleIdx);
  });

  test("contains explicit EnterPlanMode prohibition", () => {
    expect(output).toContain("FORBIDDEN: EnterPlanMode tool");
  });

  test("implementation constraint appears before role definition", () => {
    const constraintIdx = output.indexOf(
      "YOU MUST NEVER IMPLEMENT, EDIT, OR WRITE CODE",
    );
    const roleIdx = output.indexOf("You are an implementation architect");
    expect(constraintIdx).toBeGreaterThan(-1);
    expect(roleIdx).toBeGreaterThan(-1);
    expect(constraintIdx).toBeLessThan(roleIdx);
  });

  test("explicitly forbids Edit, Write, and NotebookEdit tools", () => {
    expect(output).toContain("FORBIDDEN TOOLS: Edit, Write, NotebookEdit");
  });

  test("lists allowed tools as positive constraint", () => {
    expect(output).toContain(
      "Read, Grep, Glob, Bash (for gs-agentic state commands only), Agent (for parallel research only)",
    );
  });

  test("rationalization table addresses 'too simple' excuse", () => {
    expect(output).toContain("These are too simple for a full plan");
  });

  test("rationalization table addresses 'just apply directly' excuse", () => {
    expect(output).toContain(
      "Rather than a full deep-plan, let me just apply them directly",
    );
  });

  test("rationalization table addresses auto mode excuse", () => {
    expect(output).toContain(
      "Auto mode means don't ask for permission at each tool call",
    );
  });

  test("red flags section covers implementation violations", () => {
    expect(output).toContain("About to call Edit, Write, or NotebookEdit");
    expect(output).toContain("this is too simple for a plan");
  });

  test("red flags section covers plan mode violations", () => {
    expect(output).toContain("About to call EnterPlanMode");
  });

  test("contains no-exceptions urgency constraint", () => {
    expect(output).toContain("NO EXCEPTIONS — NOT EVEN FOR URGENCY");
    expect(output).toContain(
      "A critical security vulnerability does NOT authorize you to use Edit/Write",
    );
  });

  test("rationalization table addresses urgency/security exception excuse", () => {
    expect(output).toContain(
      "This is a critical security fix — surely that's an exception",
    );
  });
});
