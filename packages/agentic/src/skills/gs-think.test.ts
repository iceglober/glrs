import { describe, test, expect } from "bun:test";
import { gsThink } from "./gs-think.js";

describe("gsThink", () => {
  const output = gsThink()["SKILL.md"];

  test("is read-only — no state mutation commands", () => {
    expect(output).not.toContain("state task create");
    expect(output).not.toContain("state task update");
    expect(output).not.toContain("state plan set");
    expect(output).not.toContain("state task transition");
    expect(output).not.toContain("state qa");
    expect(output).toContain("READ-ONLY");
    expect(output).toContain("STOP HERE");
  });

  test("includes all four verdict templates", () => {
    expect(output).toContain("Verdict: Build it");
    expect(output).toContain("Verdict: Different approach");
    expect(output).toContain("Verdict: Not yet");
    expect(output).toContain("Verdict: Don't build it");
  });

  test("suggests actions but does not take them", () => {
    // Should have explicit "Suggested actions" sections
    expect(output).toContain("Suggested actions");
    // Should suggest running /deep-plan as the next step
    expect(output).toContain("/deep-plan");
    // Should tell the agent it CAN recommend next steps
    expect(output).toContain("Suggest actions, don't take them");
    // But the user decides what happens next
    expect(output).toContain("user decides what happens next");
  });

  test("includes read-only context lookup", () => {
    expect(output).toContain("gs-agentic state task current");
    expect(output).toContain("CLAUDE.md");
  });
});
