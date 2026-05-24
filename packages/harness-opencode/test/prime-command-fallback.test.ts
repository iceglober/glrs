/**
 * Static assertions for the PRIME agent's slash-command fallback section.
 *
 * When OpenCode's TUI fails to dispatch a plugin-registered slash command,
 * the raw text (e.g. `/fresh meeting prep`) flows into the prime agent
 * as a plain user message. The prime prompt carries a fallback
 * contract: recognize the command, read the template from the bundled
 * plugin cache, substitute `$ARGUMENTS`, and execute inline.
 *
 * These tests pin the load-bearing tokens of that section — the command
 * allowlist, the announcement template, the cache read path, the edge
 * cases, and the scope-replacement rule — so future prompt edits can't
 * silently delete the fallback contract. All assertions are scoped to
 * the section body (between its heading and the next `# ` top-level
 * heading) to avoid false-positive matches elsewhere in the prompt.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dir, "..");
const ORCH_PATH = path.join(
  ROOT,
  "src",
  "agents",
  "prompts",
  "prime.md",
);
const ORCH = fs.readFileSync(ORCH_PATH, "utf8");

const SECTION_HEADING = "# Slash-command fallback";

function extractSection(): string {
  const start = ORCH.indexOf(SECTION_HEADING);
  expect(start).toBeGreaterThan(-1);
  // Find the next top-level `# ` heading (not `## ` or deeper) after our section.
  const afterHeading = start + SECTION_HEADING.length;
  const nextTopLevel = ORCH.slice(afterHeading).search(/\n# [^\n]/);
  const end = nextTopLevel === -1 ? ORCH.length : afterHeading + nextTopLevel;
  return ORCH.slice(start, end);
}

describe("prime slash-command fallback section", () => {
  it("section exists", () => {
    expect(ORCH).toContain(SECTION_HEADING);
  });

  it("section appears before SPEAR orchestration supplements", () => {
    const secIdx = ORCH.indexOf(SECTION_HEADING);
    const spearIdx = ORCH.indexOf("# SPEAR orchestration supplements");
    expect(secIdx).toBeGreaterThan(-1);
    expect(spearIdx).toBeGreaterThan(-1);
    expect(secIdx).toBeLessThan(spearIdx);
  });

  it("section lists all six recognized commands", () => {
    const body = extractSection();
    for (const cmd of [
      "/fresh",
      "/ship",
      "/review",
      "/research",
      "/init-deep",
      "/costs",
    ]) {
      expect(body).toContain(cmd);
    }
  });

  it("section does NOT list /autopilot (removed — CLI-only feature)", () => {
    // /autopilot was removed as a TUI slash command when autopilot became
    // CLI-only (`glrs oc autopilot <prompt>`). The section must not reinstate
    // it in the allowlist.
    const body = extractSection();
    // Guard against resurrection in the allowlist sentence.
    // (The word "autopilot" may still appear in surrounding narrative in
    // prime.md's carve-outs; this test scope is the fallback section only.)
    expect(body).not.toMatch(/`\/autopilot`/);
  });

  it("section documents the announcement template", () => {
    const body = extractSection();
    expect(body).toContain("→ Slash command");
    expect(body.toLowerCase()).toContain("tui dispatch missed");
  });

  it("section mentions $ARGUMENTS substitution", () => {
    const body = extractSection();
    expect(body).toContain("$ARGUMENTS");
  });

  it("section documents the cache read path", () => {
    const body = extractSection();
    expect(body).toContain(
      "~/.cache/opencode/packages/@glrs-dev/harness-plugin-opencode",
    );
  });

  it("section covers the five edge cases", () => {
    const body = extractSection();
    const lc = body.toLowerCase();
    // (a) no args → $ARGUMENTS empty
    expect(lc).toContain("no args");
    // (b) unknown /<token> falls through
    expect(lc).toContain("unknown");
    // (c) mid-message or later line is plain text
    expect(lc).toMatch(/mid-message|later line/);
    // (d) multiple recognized → only first counts
    expect(lc).toContain("first counts");
    // (e) template read failure → announce + fall through
    expect(lc).toMatch(/template read fail|not found|file missing/);
  });

  it("section states the SPEAR arc is replaced on fallback", () => {
    const body = extractSection();
    const lc = body.toLowerCase();
    expect(lc).toContain("replace");
    expect(lc).toMatch(/bootstrap|phase 0/);
  });

  it("section mentions frontmatter stripping", () => {
    const body = extractSection();
    expect(body.toLowerCase()).toContain("frontmatter");
  });

  it("section body contains no forbidden paths", () => {
    const body = extractSection();
    for (const pat of [
      "~/.claude",
      "home/.claude",
      "~/.config/opencode",
      "home/.config/opencode",
    ]) {
      expect(body).not.toContain(pat);
    }
  });
});
