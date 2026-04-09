import { describe, test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveClaudeDir,
  resolveScopeFromFlags,
  promptScope,
  computeInstallPlan,
  executeInstall,
  formatInstallResult,
  type Manifest,
  type InstallPlan,
  type InstallResult,
} from "./install-skills.js";
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

describe("executeInstall", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-skills-test-"));
  });

  function makePlan(overrides: Partial<InstallPlan> = {}): InstallPlan {
    return {
      claudeDir: tmpDir,
      commands: { "test-cmd.md": "# test command" },
      skills: { "test-skill.md": "# test skill" },
      previousManifest: { commands: [], skills: [] },
      usePrefix: false,
      force: false,
      collisions: [],
      ...overrides,
    };
  }

  test("creates new files in empty dir", () => {
    const result = executeInstall(makePlan());
    expect(result.created).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, "commands", "test-cmd.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "skills", "test-skill.md"))).toBe(true);
  });

  test("updates changed files", () => {
    const commandsDir = path.join(tmpDir, "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "test-cmd.md"), "old content");

    const result = executeInstall(makePlan({ skills: {} }));
    expect(result.updated).toBe(1);
    expect(fs.readFileSync(path.join(commandsDir, "test-cmd.md"), "utf-8")).toBe("# test command");
  });

  test("skips up-to-date files", () => {
    const commandsDir = path.join(tmpDir, "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "test-cmd.md"), "# test command");

    const result = executeInstall(makePlan({ skills: {} }));
    expect(result.upToDate).toBe(1);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
  });

  test("removes stale files from previous manifest", () => {
    const commandsDir = path.join(tmpDir, "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "old-cmd.md"), "stale");

    const result = executeInstall(
      makePlan({
        previousManifest: { commands: ["old-cmd.md"], skills: [] },
      }),
    );
    expect(result.removed).toBe(1);
    expect(fs.existsSync(path.join(commandsDir, "old-cmd.md"))).toBe(false);
  });

  test("writes manifest file", () => {
    executeInstall(makePlan());
    const manifestPath = path.join(tmpDir, ".glorious-skills.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.commands).toEqual(["test-cmd.md"]);
    expect(manifest.skills).toEqual(["test-skill.md"]);
  });
});

describe("formatInstallResult", () => {
  const base: InstallResult = {
    created: 0,
    updated: 0,
    upToDate: 0,
    removed: 0,
    commandNames: [],
    skillNames: [],
    target: ".claude/",
  };

  test("shows created count", () => {
    const lines = formatInstallResult({ ...base, created: 3 });
    expect(lines.some((l) => l.includes("created 3 new files"))).toBe(true);
  });

  test("shows updated count", () => {
    const lines = formatInstallResult({ ...base, updated: 2 });
    expect(lines.some((l) => l.includes("updated 2 files"))).toBe(true);
  });

  test("shows removed count", () => {
    const lines = formatInstallResult({ ...base, removed: 1 });
    expect(lines.some((l) => l.includes("removed 1 stale file"))).toBe(true);
  });

  test("shows up-to-date message when nothing changed", () => {
    const lines = formatInstallResult({ ...base, upToDate: 5 });
    expect(lines.some((l) => l.includes("all skills up to date"))).toBe(true);
  });

  test("lists command slugs", () => {
    const lines = formatInstallResult({
      ...base,
      created: 1,
      commandNames: ["glorious/work.md"],
    });
    expect(lines.some((l) => l.includes("/glorious:work"))).toBe(true);
  });

  test("lists skill slugs", () => {
    const lines = formatInstallResult({
      ...base,
      created: 1,
      skillNames: ["browser.md"],
    });
    expect(lines.some((l) => l.includes("/browser"))).toBe(true);
  });
});

describe("resolveScopeFromFlags", () => {
  test("--project returns project", () => {
    expect(resolveScopeFromFlags({ project: true, user: false })).toBe("project");
  });

  test("--user returns user", () => {
    expect(resolveScopeFromFlags({ user: true, project: false })).toBe("user");
  });

  test("both flags throws", () => {
    expect(() => resolveScopeFromFlags({ user: true, project: true })).toThrow(
      "Cannot use --user and --project together",
    );
  });

  test("neither flag returns null", () => {
    expect(resolveScopeFromFlags({ user: false, project: false })).toBeNull();
  });
});

describe("promptScope", () => {
  test("returns user when selected", async () => {
    const result = await promptScope({
      isTTY: true,
      selectFn: async () => "user" as const,
    });
    expect(result).toBe("user");
  });

  test("returns project when selected", async () => {
    const result = await promptScope({
      isTTY: true,
      selectFn: async () => "project" as const,
    });
    expect(result).toBe("project");
  });

  test("falls back to project when not TTY", async () => {
    let selectCalled = false;
    const result = await promptScope({
      isTTY: false,
      selectFn: async () => {
        selectCalled = true;
        return "user" as const;
      },
    });
    expect(result).toBe("project");
    expect(selectCalled).toBe(false);
  });

  test("falls back to project on cancel (null)", async () => {
    const result = await promptScope({
      isTTY: true,
      selectFn: async () => null,
    });
    expect(result).toBe("project");
  });
});
