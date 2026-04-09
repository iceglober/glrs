import { describe, test, expect } from "bun:test";
import path from "node:path";
import os from "node:os";
import { resolveClaudeDir, computeInstallPlan, type Manifest } from "./install-skills.js";
import { COMMANDS, SKILLS } from "../skills/index.js";

describe("resolveClaudeDir", () => {
  test("user scope returns ~/.claude", () => {
    const result = resolveClaudeDir("user");
    expect(result).toBe(path.join(os.homedir(), ".claude"));
  });

  test("project scope returns gitRoot/.claude", () => {
    const result = resolveClaudeDir("project", () => "/tmp/repo");
    expect(result).toBe("/tmp/repo/.claude");
  });

  test("project scope throws when not in git repo", () => {
    expect(() =>
      resolveClaudeDir("project", () => {
        throw new Error("not a git repo");
      }),
    ).toThrow();
  });
});

describe("computeInstallPlan", () => {
  const emptyManifest: Manifest = { commands: [], skills: [] };
  const noopFs = {
    readManifestFn: () => emptyManifest,
    existsFn: () => false,
    readFileFn: () => "",
  };

  test("default plan with project scope", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: false,
      force: false,
      ...noopFs,
    });
    expect(plan.claudeDir).toBe("/tmp/repo/.claude");
    expect(plan.commands).toEqual(COMMANDS);
    expect(plan.skills).toEqual(SKILLS);
    expect(plan.collisions).toEqual([]);
  });

  test("prefix wraps files under glorious/", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: true,
      force: false,
      ...noopFs,
    });
    for (const key of Object.keys(plan.commands)) {
      expect(key).toStartWith("glorious/");
    }
    for (const key of Object.keys(plan.skills)) {
      expect(key).toStartWith("glorious/");
    }
  });

  test("force skips collision detection", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: false,
      force: true,
      readManifestFn: () => emptyManifest,
      existsFn: () => true,
      readFileFn: () => "different content",
    });
    expect(plan.collisions).toEqual([]);
  });

  test("detects collisions for new files", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: false,
      force: false,
      readManifestFn: () => emptyManifest,
      existsFn: () => true,
      readFileFn: () => "different content",
    });
    expect(plan.collisions.length).toBeGreaterThan(0);
  });

  test("no collision for previously-installed files", () => {
    const previousManifest: Manifest = {
      commands: Object.keys(COMMANDS),
      skills: Object.keys(SKILLS),
    };
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: false,
      force: false,
      readManifestFn: () => previousManifest,
      existsFn: () => true,
      readFileFn: () => "different content",
    });
    expect(plan.collisions).toEqual([]);
  });
});
