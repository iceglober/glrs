import { describe, test, expect } from "bun:test";
import { gsDeepPlan } from "./gs-deep-plan.js";

describe("gsDeepPlan", () => {
  const entry = gsDeepPlan();
  const output = entry["SKILL.md"];

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

  test("contains no-exceptions urgency constraint", () => {
    expect(output).toContain("NO EXCEPTIONS — NOT EVEN FOR URGENCY");
    expect(output).toContain(
      "A critical security vulnerability does NOT authorize you to use Edit/Write",
    );
  });

  test("SKILL.md has reference map pointing to tdd-methodology and anti-rationalization", () => {
    expect(output).toContain("## Reference map");
    expect(output).toContain("references/tdd-methodology.md");
    expect(output).toContain("references/anti-rationalization.md");
  });

  // --- Reference file tests ---

  test("has references/tdd-methodology.md with Red-Green-Refactor", () => {
    const tdd = entry["references/tdd-methodology.md"];
    expect(tdd).toBeDefined();
    expect(tdd).toContain("Red -> Green -> Refactor");
  });

  test("tdd-methodology has all 4 test layers", () => {
    const tdd = entry["references/tdd-methodology.md"];
    expect(tdd).toContain("Unit");
    expect(tdd).toContain("Integration");
    expect(tdd).toContain("Contract/API");
    expect(tdd).toContain("Behavioral/E2E");
  });

  test("has references/anti-rationalization.md with rationalization table", () => {
    const anti = entry["references/anti-rationalization.md"];
    expect(anti).toBeDefined();
    expect(anti).toContain("These are too simple for a full plan");
    expect(anti).toContain("Rather than a full deep-plan, let me just apply them directly");
    expect(anti).toContain("Auto mode means don't ask for permission at each tool call");
    expect(anti).toContain("This is a critical security fix — surely that's an exception");
  });

  test("anti-rationalization has red flags section", () => {
    const anti = entry["references/anti-rationalization.md"];
    expect(anti).toContain("About to call Edit, Write, or NotebookEdit");
    expect(anti).toContain("About to call EnterPlanMode");
    expect(anti).toContain("this is too simple for a plan");
  });
});
