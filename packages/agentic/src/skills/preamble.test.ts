import { describe, test, expect } from "bun:test";
import { READONLY_PREAMBLE, TASK_PREAMBLE, REVIEW_PREAMBLE, BUILD_PREAMBLE } from "./preamble.js";

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
