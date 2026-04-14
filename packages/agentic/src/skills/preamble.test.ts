import { describe, test, expect } from "bun:test";
import { READONLY_PREAMBLE, TASK_PREAMBLE, REVIEW_PREAMBLE, BUILD_PREAMBLE, HANDOFF_RULE, buildHandoffBlock } from "./preamble.js";

describe("TASK_PREAMBLE", () => {
  test("contains plan sync recipe with ref format", () => {
    expect(TASK_PREAMBLE).toContain("plan sync --stdin");
    expect(TASK_PREAMBLE).toContain("ref:");
  });

  test("contains output convention with tail -1", () => {
    expect(TASK_PREAMBLE).toContain("last line");
    expect(TASK_PREAMBLE).toContain("tail -1");
  });

  test("contains claim-build-done recipe", () => {
    expect(TASK_PREAMBLE).toContain("task next --epic");
    expect(TASK_PREAMBLE).toContain("--claim");
    expect(TASK_PREAMBLE).toContain("--phase done");
  });
});

describe("BUILD_PREAMBLE", () => {
  test("contains output convention with tail -1", () => {
    expect(BUILD_PREAMBLE).toContain("last line");
    expect(BUILD_PREAMBLE).toContain("tail -1");
  });

  test("contains --claim for task next", () => {
    expect(BUILD_PREAMBLE).toContain("--claim");
  });
});

describe("REVIEW_PREAMBLE", () => {
  test("contains review create mutation", () => {
    expect(REVIEW_PREAMBLE).toContain("review create");
  });
});

describe("READONLY_PREAMBLE", () => {
  test("does not contain state mutation commands", () => {
    expect(READONLY_PREAMBLE).not.toContain("transition");
    expect(READONLY_PREAMBLE).not.toContain("update --id");
    expect(READONLY_PREAMBLE).not.toContain("--claim");
    expect(READONLY_PREAMBLE).not.toContain("plan sync");
  });
});

describe("all preambles reference gs-agentic state", () => {
  test("each preamble mentions gs-agentic state", () => {
    for (const preamble of [READONLY_PREAMBLE, TASK_PREAMBLE, REVIEW_PREAMBLE, BUILD_PREAMBLE]) {
      expect(preamble).toContain("gs-agentic state");
    }
  });
});

describe("HANDOFF_RULE", () => {
  test("contains authority language", () => {
    expect(HANDOFF_RULE).toContain("MUST");
    expect(HANDOFF_RULE).toContain("Do NOT");
    expect(HANDOFF_RULE).toContain("IMMEDIATE");
  });

  test("forbids text before tool call", () => {
    expect(HANDOFF_RULE).toContain("Do NOT output any text before the Skill tool call");
  });

  test("contains section header", () => {
    expect(HANDOFF_RULE).toContain("Skill Handoff Rule");
  });
});

describe("buildHandoffBlock", () => {
  const basic = buildHandoffBlock({
    question: "What next?",
    header: "Next",
    options: [
      { label: "Build (Recommended)", description: "Start building", action: 'Skill("build")' },
      { label: "Done", description: "Stop here", action: "stop" },
    ],
  });

  test("produces AskUserQuestion format", () => {
    expect(basic).toContain('question: "What next?"');
    expect(basic).toContain('header: "Next"');
    expect(basic).toContain("Build (Recommended)");
  });

  test("produces dispatch table with YOUR ACTION header", () => {
    expect(basic).toContain("YOUR ACTION");
    expect(basic).toContain('Skill("build")');
  });

  test("includes constraint block", () => {
    expect(basic).toContain("Do NOT output any text before the Skill tool call");
  });

  test("handles freeText option", () => {
    const withFree = buildHandoffBlock({
      question: "What next?",
      header: "Next",
      options: [{ label: "Build", description: "Build it", action: 'Skill("build")' }],
      freeText: "go back to Step 8",
    });
    expect(withFree).toContain("free text");
    expect(withFree).toContain("go back to Step 8");
  });

  test("omits freeText when not provided", () => {
    expect(basic).not.toContain("free text");
  });

  test("handles action strings with args", () => {
    const withArgs = buildHandoffBlock({
      question: "What next?",
      header: "Next",
      options: [{ label: "Plan", description: "Plan fixes", action: 'Skill("deep-plan", args: "fix summary")' }],
    });
    expect(withArgs).toContain('Skill("deep-plan", args: "fix summary")');
  });
});
