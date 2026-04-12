import { describe, test, expect } from "bun:test";
import { buildCommands, GS_SKILL_NAMES, BUILTIN_COLLISIONS, SKILLS } from "./index.js";

describe("GS_SKILL_NAMES", () => {
  test("has entry for every gs skill (12 total)", () => {
    expect(Object.keys(GS_SKILL_NAMES).length).toBe(12);
  });

  test("contains all expected skill keys", () => {
    const keys = Object.keys(GS_SKILL_NAMES);
    expect(keys).toContain("gs");
    expect(keys).toContain("gs-think");
    expect(keys).toContain("gs-work");
    expect(keys).toContain("gs-fix");
    expect(keys).toContain("gs-qa");
    expect(keys).toContain("gs-ship");
    expect(keys).toContain("gs-build");
    expect(keys).toContain("gs-build-loop");
    expect(keys).toContain("gs-deep-plan");
    expect(keys).toContain("gs-deep-review");
    expect(keys).toContain("gs-quick-review");
    expect(keys).toContain("gs-address-feedback");
  });

  test("each entry has canonical name and generator", () => {
    for (const [key, entry] of Object.entries(GS_SKILL_NAMES)) {
      expect(entry.canonical).toBeString();
      expect(entry.canonical).toEndWith(".md");
      expect(typeof entry.generator).toBe("function");
    }
  });
});

describe("BUILTIN_COLLISIONS", () => {
  test("contains known Claude Code built-in names", () => {
    expect(BUILTIN_COLLISIONS.has("plan.md")).toBe(true);
    expect(BUILTIN_COLLISIONS.has("review.md")).toBe(true);
    expect(BUILTIN_COLLISIONS.has("status.md")).toBe(true);
    expect(BUILTIN_COLLISIONS.has("fast.md")).toBe(true);
    expect(BUILTIN_COLLISIONS.has("init.md")).toBe(true);
    expect(BUILTIN_COLLISIONS.has("diff.md")).toBe(true);
  });

  test("does not contain our canonical names", () => {
    expect(BUILTIN_COLLISIONS.has("think.md")).toBe(false);
    expect(BUILTIN_COLLISIONS.has("work.md")).toBe(false);
    expect(BUILTIN_COLLISIONS.has("fix.md")).toBe(false);
    expect(BUILTIN_COLLISIONS.has("qa.md")).toBe(false);
    expect(BUILTIN_COLLISIONS.has("ship.md")).toBe(false);
    expect(BUILTIN_COLLISIONS.has("deep-plan.md")).toBe(false);
    expect(BUILTIN_COLLISIONS.has("deep-review.md")).toBe(false);
  });
});

describe("buildCommands", () => {
  test("with no prefix returns canonical short names", () => {
    const cmds = buildCommands();
    expect(cmds["think.md"]).toBeDefined();
    expect(cmds["work.md"]).toBeDefined();
    expect(cmds["deep-plan.md"]).toBeDefined();
    expect(cmds["deep-review.md"]).toBeDefined();
    expect(cmds["gs.md"]).toBeDefined();
    // Should NOT have gs- prefixed keys (except gs.md itself)
    expect(cmds["gs-think.md"]).toBeUndefined();
    expect(cmds["gs-work.md"]).toBeUndefined();
  });

  test("with gs- prefix returns legacy names", () => {
    const cmds = buildCommands("gs-");
    expect(cmds["gs-think.md"]).toBeDefined();
    expect(cmds["gs-work.md"]).toBeDefined();
    expect(cmds["gs-deep-plan.md"]).toBeDefined();
    // gs.md becomes gs-gs.md with prefix
    expect(cmds["gs-gs.md"]).toBeDefined();
  });

  test("preserves non-gs skill names unchanged", () => {
    const cmds = buildCommands();
    expect(cmds["research.md"]).toBeDefined();
    expect(cmds["spec-make.md"]).toBeDefined();
    expect(cmds["product-manager.md"]).toBeDefined();
    expect(cmds["research-local.md"]).toBeDefined();
  });

  test("with custom prefix applies to gs skills only", () => {
    const cmds = buildCommands("my-");
    expect(cmds["my-think.md"]).toBeDefined();
    expect(cmds["my-work.md"]).toBeDefined();
    // Non-gs skills unchanged
    expect(cmds["research.md"]).toBeDefined();
    expect(cmds["spec-make.md"]).toBeDefined();
  });

  test("with empty string prefix same as no prefix", () => {
    const noPrefix = buildCommands();
    const emptyPrefix = buildCommands("");
    expect(Object.keys(noPrefix).sort()).toEqual(Object.keys(emptyPrefix).sort());
  });

  test("all commands return non-empty markdown", () => {
    const cmds = buildCommands();
    for (const [key, content] of Object.entries(cmds)) {
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain("---"); // frontmatter
    }
  });
});

describe("SKILLS", () => {
  test("contains browser skill", () => {
    expect(SKILLS["browser.md"]).toBeDefined();
  });

  test("contains writing-skills", () => {
    const wsKeys = Object.keys(SKILLS).filter((k) => k.startsWith("writing-skills/"));
    expect(wsKeys.length).toBeGreaterThan(0);
  });
});
