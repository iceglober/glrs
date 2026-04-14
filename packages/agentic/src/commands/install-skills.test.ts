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
import { buildCommands, SKILLS } from "../skills/index.js";

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

  test("default plan with no prefix uses canonical short names", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
      force: false,
      ...noopFs,
    });
    expect(plan.claudeDir).toBe("/tmp/repo/.claude");
    // Should have canonical short names
    expect(plan.commands["think.md"]).toBeDefined();
    expect(plan.commands["work.md"]).toBeDefined();
    expect(plan.commands["deep-plan.md"]).toBeDefined();
    // Should NOT have gs- prefixed names
    expect(plan.commands["gs-think.md"]).toBeUndefined();
    expect(plan.commands["gs-work.md"]).toBeUndefined();
    // Non-gs skills unchanged
    expect(plan.commands["research.md"]).toBeDefined();
    expect(plan.commands["spec-make.md"]).toBeDefined();
    expect(plan.collisions).toEqual([]);
  });

  test("prefix gs- produces legacy names", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: "gs-",
      force: false,
      ...noopFs,
    });
    expect(plan.commands["gs-think.md"]).toBeDefined();
    expect(plan.commands["gs-work.md"]).toBeDefined();
    expect(plan.commands["gs-deep-plan.md"]).toBeDefined();
    // Non-gs skills still unchanged
    expect(plan.commands["research.md"]).toBeDefined();
  });

  test("custom prefix applies to gs skills only", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: "my-",
      force: false,
      ...noopFs,
    });
    expect(plan.commands["my-think.md"]).toBeDefined();
    expect(plan.commands["my-work.md"]).toBeDefined();
    // Non-gs unchanged
    expect(plan.commands["research.md"]).toBeDefined();
  });

  test("force skips collision detection", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
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
      prefix: undefined,
      force: false,
      readManifestFn: () => emptyManifest,
      existsFn: () => true,
      readFileFn: () => "different content",
    });
    expect(plan.collisions.length).toBeGreaterThan(0);
  });

  test("scope field is set correctly in plan", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
      force: false,
      scope: "user",
      ...noopFs,
    });
    expect(plan.scope).toBe("user");
  });

  test("no collision for previously-installed files", () => {
    const defaultCommands = buildCommands();
    const previousManifest: Manifest = {
      commands: Object.keys(defaultCommands),
      skills: Object.keys(SKILLS),
    };
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
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
      prefix: undefined,
      force: false,
      collisions: [],
      scope: "project",
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

  test("user scope plan produces ~/.claude/ target", () => {
    const result = executeInstall(makePlan({ scope: "user" }));
    expect(result.target).toBe("~/.claude/");
  });

  test("project scope plan produces .claude/ target", () => {
    const result = executeInstall(makePlan({ scope: "project" }));
    expect(result.target).toBe(".claude/");
  });

  test("writes manifest file", () => {
    executeInstall(makePlan());
    const manifestPath = path.join(tmpDir, ".glorious-skills.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.commands).toEqual(["test-cmd.md"]);
    expect(manifest.skills).toEqual(["test-skill.md"]);
  });

  test("no .tmp file remains after manifest write", () => {
    executeInstall(makePlan());
    const tmpPath = path.join(tmpDir, ".glorious-skills.json.tmp");
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  test("manifest includes version after install", () => {
    executeInstall(makePlan());
    const manifestPath = path.join(tmpDir, ".glorious-skills.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version.length).toBeGreaterThan(0);
  });

  test("manifest includes empty prefix when no prefix", () => {
    executeInstall(makePlan({ prefix: undefined }));
    const manifestPath = path.join(tmpDir, ".glorious-skills.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.prefix).toBe("");
  });

  test("manifest includes gs- prefix when prefix set", () => {
    executeInstall(makePlan({ prefix: "gs-" }));
    const manifestPath = path.join(tmpDir, ".glorious-skills.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.prefix).toBe("gs-");
  });

  test("install-then-read roundtrip preserves version and prefix", () => {
    executeInstall(makePlan({ prefix: "gs-" }));
    // computeInstallPlan reads the manifest internally
    const plan2 = computeInstallPlan({
      claudeDir: tmpDir,
      prefix: "gs-",
      force: false,
    });
    expect(plan2.previousManifest.version).toBeDefined();
    expect(typeof plan2.previousManifest.version).toBe("string");
    expect(plan2.previousManifest.prefix).toBe("gs-");
  });

  test("old manifest without version reads as undefined", () => {
    // Write an old-format manifest (no version/prefix)
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".glorious-skills.json"),
      JSON.stringify({ commands: ["x.md"], skills: [] }),
    );
    const plan = computeInstallPlan({
      claudeDir: tmpDir,
      prefix: undefined,
      force: false,
    });
    expect(plan.previousManifest.version).toBeUndefined();
    expect(plan.previousManifest.prefix).toBeUndefined();
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

  test("lists command slugs with canonical names", () => {
    const lines = formatInstallResult({
      ...base,
      created: 1,
      commandNames: ["think.md", "deep-plan.md"],
    });
    expect(lines.some((l) => l.includes("/think"))).toBe(true);
    expect(lines.some((l) => l.includes("/deep-plan"))).toBe(true);
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
