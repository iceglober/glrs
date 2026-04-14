import { describe, test, expect } from "bun:test";
import { gs } from "./gs.js";
import { gsThink } from "./gs-think.js";
import { gsDeepPlan } from "./gs-deep-plan.js";
import { gsDeepReview } from "./gs-deep-review.js";
import { gsQuickReview } from "./gs-quick-review.js";
import { gsBuild } from "./gs-build.js";
import { gsBuildLoop } from "./gs-build-loop.js";
import { gsAddressFeedback } from "./gs-address-feedback.js";
import { gsQa } from "./gs-qa.js";
import { gsFix } from "./gs-fix.js";
import { gsWork } from "./gs-work.js";
import { gsShip } from "./gs-ship.js";

/** Helper to extract SKILL.md content from a generator that returns SkillEntry */
function md(gen: () => Record<string, string>): string {
  return gen()["SKILL.md"];
}

describe("cross-references use canonical names", () => {
  test("gs.ts skill table uses canonical names", () => {
    const output = md(gs);
    expect(output).toContain("/think");
    expect(output).toContain("/work");
    expect(output).toContain("/fix");
    expect(output).toContain("/qa");
    expect(output).toContain("/ship");
    expect(output).toContain("/build");
    expect(output).toContain("/deep-plan");
    expect(output).toContain("/deep-review");
    // Should NOT contain /gs- prefixed skill names
    expect(output).not.toContain("/gs-think");
    expect(output).not.toContain("/gs-work");
    expect(output).not.toContain("/gs-fix");
  });

  test("gs-think uses /deep-plan not /gs-deep-plan", () => {
    const output = md(gsThink);
    expect(output).toContain("/deep-plan");
    expect(output).not.toContain("/gs-deep-plan");
    expect(output).not.toContain("/gs-work");
  });

  test("gs-deep-plan uses canonical cross-refs", () => {
    const output = md(gsDeepPlan);
    expect(output).toContain("/build");
    expect(output).toContain("/build-loop");
    expect(output).not.toContain("/gs-build");
    expect(output).not.toContain("/gs-build-loop");
  });

  test("gs-deep-review uses canonical cross-refs", () => {
    const output = md(gsDeepReview);
    expect(output).toContain("deep-plan");
    expect(output).toContain('skill: "qa"');
    expect(output).toContain('skill: "ship"');
    expect(output).not.toContain("/gs-deep-plan");
    expect(output).not.toContain("/gs-qa");
    expect(output).not.toContain("/gs-ship");
  });

  test("gs-quick-review uses canonical cross-refs", () => {
    const output = md(gsQuickReview);
    expect(output).toContain("/deep-plan");
    expect(output).not.toContain("/gs-deep-review");
    expect(output).not.toContain("/gs-deep-plan");
  });

  test("gs-build uses canonical cross-refs", () => {
    const output = md(gsBuild);
    expect(output).toContain("/build t3");
    expect(output).toContain("/deep-plan");
    expect(output).toContain('skill: "deep-review"');
    expect(output).toContain('skill: "quick-review"');
    expect(output).toContain('skill: "ship"');
    expect(output).not.toContain("/gs-build t3");
    expect(output).not.toContain("/gs-deep-plan");
    expect(output).not.toContain("/gs-ship");
  });

  test("gs-build-loop uses canonical cross-refs", () => {
    const output = md(gsBuildLoop);
    expect(output).toContain("/build");
    expect(output).toContain("/deep-plan");
    expect(output).not.toContain("/gs-build");
    expect(output).not.toContain("/gs-deep-plan");
  });

  test("gs-address-feedback uses canonical cross-refs", () => {
    const output = md(gsAddressFeedback);
    expect(output).toContain("/ship");
    expect(output).toContain("/deep-review");
    expect(output).toContain("/quick-review");
    expect(output).not.toContain("/gs-ship");
    expect(output).not.toContain("/gs-deep-review");
    expect(output).not.toContain("/gs-quick-review");
  });

  test("gs-qa uses canonical cross-refs", () => {
    const output = md(gsQa);
    expect(output).toContain("/work");
    expect(output).not.toContain("/gs-work");
  });

  test("no skill uses text-based slash command handoff", () => {
    const skills = [gs, gsThink, gsDeepPlan, gsDeepReview, gsQuickReview, gsBuild, gsBuildLoop, gsAddressFeedback, gsQa, gsFix, gsWork, gsShip];
    for (const skill of skills) {
      const output = md(skill);
      const matches = output.match(/respond with exactly [`']?\/\w/g);
      if (matches) {
        throw new Error(`Found text-based handoff in skill output: ${matches.join(", ")}. Use Skill tool instead.`);
      }
    }
  });

  test("no skill file contains /gs- slash command references (except gs-agentic CLI)", () => {
    const skills = [gs, gsThink, gsDeepPlan, gsDeepReview, gsQuickReview, gsBuild, gsBuildLoop, gsAddressFeedback, gsQa, gsFix, gsWork, gsShip];
    for (const skill of skills) {
      const output = md(skill);
      // Find all /gs- references that aren't gs-agentic CLI calls
      const matches = output.match(/\/gs-(?!agentic)/g);
      if (matches) {
        throw new Error(`Found /gs- reference in skill output: ${matches.join(", ")}`);
      }
    }
  });

  // ── Standardized handoff format ────────────────────────────────────

  const HANDOFF_SKILLS = [
    { name: "gs-deep-plan", fn: gsDeepPlan },
    { name: "gs-build", fn: gsBuild },
    { name: "gs-build-loop", fn: gsBuildLoop },
    { name: "gs-deep-review", fn: gsDeepReview },
    { name: "gs-quick-review", fn: gsQuickReview },
  ];

  const NON_HANDOFF_SKILLS = [
    { name: "gs-think", fn: gsThink },
    { name: "gs-fix", fn: gsFix },
    { name: "gs-work", fn: gsWork },
    { name: "gs-qa", fn: gsQa },
    { name: "gs-ship", fn: gsShip },
  ];

  test("all handoff skills contain HANDOFF_RULE", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      if (!output.includes("Skill Handoff Rule")) {
        throw new Error(`${name} is missing HANDOFF_RULE ("Skill Handoff Rule" text)`);
      }
    }
  });

  test("all handoff skills use structured dispatch table", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      if (!output.includes("YOUR ACTION")) {
        throw new Error(`${name} is missing structured dispatch table ("YOUR ACTION" header)`);
      }
    }
  });

  test("all handoff skills have constraint block", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      if (!output.includes("MUST contain ONLY the Skill tool call")) {
        throw new Error(`${name} is missing constraint block`);
      }
    }
  });

  test("no handoff skill uses old prose dispatch format", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      const matches = output.match(/invoke the \w[\w-]* skill using the Skill tool:/g);
      if (matches) {
        throw new Error(`${name} still uses old prose dispatch: ${matches.join(", ")}`);
      }
    }
  });

  test("all handoff skills warn against slash command text output", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      if (!output.includes("slash commands only work when the USER types them")) {
        throw new Error(`${name} is missing slash-command-as-text warning in HANDOFF_RULE`);
      }
    }
  });

  test("all handoff skills have Red Flags section", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      if (!output.includes("Red Flags")) {
        throw new Error(`${name} is missing Red Flags section in HANDOFF_RULE`);
      }
    }
  });

  test("dispatch table actions use 'Call Skill tool' format not Skill() pseudo-code", () => {
    for (const { name, fn } of HANDOFF_SKILLS) {
      const output = md(fn);
      // Catches both Skill("name") and Skill("name", args: "...")
      const pseudoCodeInTable = output.match(/\|\s*Skill\([^)]+\)\s*\|/g);
      if (pseudoCodeInTable) {
        throw new Error(`${name} dispatch table still uses Skill() pseudo-code: ${pseudoCodeInTable.join(", ")}. Use "Call Skill tool → skill:" format.`);
      }
    }
  });

  test("non-handoff skills do not contain HANDOFF_RULE", () => {
    for (const { name, fn } of NON_HANDOFF_SKILLS) {
      const output = md(fn);
      if (output.includes("Skill Handoff Rule")) {
        throw new Error(`${name} should NOT contain HANDOFF_RULE — it has no skill-to-skill handoff`);
      }
    }
  });
});
