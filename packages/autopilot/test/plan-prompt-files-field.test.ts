/**
 * Tests that the @plan agent's multi-file phase template includes the
 * `files:` field in the plan-state fence example.
 *
 * Prevents regression of the prompt template — if someone removes the
 * files: field, the build fails here before it reaches users.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const PLAN_PROMPT = path.join(ROOT, "..", "harness-opencode", "src", "agents", "prompts", "plan.md");

describe("multi-file phase template", () => {
  let content: string;

  // Read once for all tests in this describe block
  content = fs.readFileSync(PLAN_PROMPT, "utf8");

  it("multi-file phase template contains files: field in plan-state example", () => {
    // The phase_N.md template section should contain a files: field
    // Find the phase_N.md template block
    const phaseTemplateStart = content.indexOf("# phase_N.md");
    expect(phaseTemplateStart).toBeGreaterThan(-1);

    const phaseSection = content.slice(phaseTemplateStart);
    expect(phaseSection).toContain("files:");
  });

  it("files: field shows path, NEW marker, and Change description", () => {
    const phaseTemplateStart = content.indexOf("# phase_N.md");
    expect(phaseTemplateStart).toBeGreaterThan(-1);

    const phaseSection = content.slice(phaseTemplateStart);

    // Should show a path with (NEW) marker
    expect(phaseSection).toContain("(NEW)");

    // Should show a Change: description under the file entry
    expect(phaseSection).toContain("Change:");
  });
});
