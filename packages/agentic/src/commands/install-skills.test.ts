import { describe, test, expect, beforeEach, afterEach } from "bun:test";
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
  autoSyncSkills,
  validateSkill,
  testTriggers,
  type Manifest,
  type InstallPlan,
  type InstallResult,
} from "./install-skills.js";
import { buildCommands, buildAllSkills, SKILLS } from "../skills/index.js";

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

  test("default format is skills — all skills in skills map, commands empty", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
      force: false,
      ...noopFs,
    });
    expect(plan.claudeDir).toBe("/tmp/repo/.claude");
    expect(plan.format).toBe("skills");
    // Commands should be empty in skills format
    expect(Object.keys(plan.commands)).toEqual([]);
    // Skills should have directory-format keys
    expect(plan.skills["think/SKILL.md"]).toBeDefined();
    expect(plan.skills["work/SKILL.md"]).toBeDefined();
    expect(plan.skills["deep-plan/SKILL.md"]).toBeDefined();
    expect(plan.skills["research/SKILL.md"]).toBeDefined();
    expect(plan.skills["browser/SKILL.md"]).toBeDefined();
    expect(plan.collisions).toEqual([]);
  });

  test("format commands produces legacy flat layout", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
      force: false,
      format: "commands",
      ...noopFs,
    });
    expect(plan.format).toBe("commands");
    expect(plan.commands["think.md"]).toBeDefined();
    expect(plan.commands["work.md"]).toBeDefined();
    expect(plan.commands["deep-plan.md"]).toBeDefined();
    // Non-gs skills unchanged
    expect(plan.commands["research.md"]).toBeDefined();
  });

  test("prefix gs- with skills format prefixes skill dirs", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: "gs-",
      force: false,
      ...noopFs,
    });
    expect(plan.skills["gs-think/SKILL.md"]).toBeDefined();
    expect(plan.skills["gs-work/SKILL.md"]).toBeDefined();
    // Non-gs skills still unprefixed
    expect(plan.skills["research/SKILL.md"]).toBeDefined();
  });

  test("prefix gs- with commands format produces legacy names", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: "gs-",
      force: false,
      format: "commands",
      ...noopFs,
    });
    expect(plan.commands["gs-think.md"]).toBeDefined();
    expect(plan.commands["gs-work.md"]).toBeDefined();
    expect(plan.commands["research.md"]).toBeDefined();
  });

  test("custom prefix applies to gs skills only", () => {
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: "my-",
      force: false,
      ...noopFs,
    });
    expect(plan.skills["my-think/SKILL.md"]).toBeDefined();
    expect(plan.skills["my-work/SKILL.md"]).toBeDefined();
    // Non-gs unchanged
    expect(plan.skills["research/SKILL.md"]).toBeDefined();
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

  test("no collision for previously-installed files (skills format)", () => {
    const allSkills = buildAllSkills();
    const previousManifest: Manifest = {
      format: "skills",
      commands: [],
      skills: Object.keys(allSkills),
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

  test("no collision for previously-installed files (commands format)", () => {
    const defaultCommands = buildCommands();
    const previousManifest: Manifest = {
      format: "commands",
      commands: Object.keys(defaultCommands),
      skills: Object.keys(SKILLS),
    };
    const plan = computeInstallPlan({
      claudeDir: "/tmp/repo/.claude",
      prefix: undefined,
      force: false,
      format: "commands",
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

  afterEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  function makePlan(overrides: Partial<InstallPlan> = {}): InstallPlan {
    return {
      claudeDir: tmpDir,
      commands: { "test-cmd.md": "# test command" },
      skills: { "test-skill.md": "# test skill" },
      previousManifest: { commands: [], skills: [] },
      prefix: undefined,
      format: "commands",
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

describe("autoSyncSkills", () => {
  let tmpHome: string;
  let tmpProject: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gs-autosync-home-"));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "gs-autosync-proj-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpHome)) fs.rmSync(tmpHome, { recursive: true });
    if (fs.existsSync(tmpProject)) fs.rmSync(tmpProject, { recursive: true });
  });

  function writeManifestTo(dir: string, manifest: Partial<Manifest> & { commands: string[]; skills: string[] }) {
    const claudeDir = path.join(dir, ".claude");
    fs.mkdirSync(path.join(claudeDir, "commands"), { recursive: true });
    fs.mkdirSync(path.join(claudeDir, "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, ".glorious-skills.json"),
      JSON.stringify(manifest, null, 2),
    );
    // Write dummy command files so they exist on disk
    for (const cmd of manifest.commands) {
      fs.writeFileSync(path.join(claudeDir, "commands", cmd), "old content");
    }
    for (const skill of manifest.skills) {
      const p = path.join(claudeDir, "skills", skill);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "old content");
    }
  }

  function readManifestFrom(dir: string): Manifest {
    const p = path.join(dir, ".claude", ".glorious-skills.json");
    if (!fs.existsSync(p)) return { commands: [], skills: [] };
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }

  test("skips when auto-update is false", () => {
    const result = autoSyncSkills({
      getSettingFn: (key) => key === "skills.auto-update" ? "false" : undefined,
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("should not be called"); },
    });
    expect(result.userSynced).toBe(false);
    expect(result.projectSynced).toBe(false);
  });

  test("auto-installs to user scope on first run (no manifest)", () => {
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    expect(result.userSynced).toBe(true);
    const m = readManifestFrom(tmpHome);
    // New default: skills format — skills array populated, commands empty
    expect(m.skills.length).toBeGreaterThan(0);
    expect(m.version).toBeDefined();
  });

  test("syncs user scope when version mismatch", () => {
    writeManifestTo(tmpHome, {
      version: "0.0.1",
      prefix: "",
      commands: ["think.md"],
      skills: ["browser.md"],
    });
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    expect(result.userSynced).toBe(true);
    const m = readManifestFrom(tmpHome);
    expect(m.version).not.toBe("0.0.1");
    // After sync: skills format — skills populated
    expect(m.skills.length).toBeGreaterThan(1);
  });

  test("skips user scope when version matches", () => {
    // First install to get the current version stamp
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    // Second call should skip
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    expect(result.userSynced).toBe(false);
  });

  test("syncs project scope when previously installed with old version", () => {
    writeManifestTo(tmpProject, {
      version: "0.0.1",
      prefix: "",
      commands: ["think.md"],
      skills: ["browser.md"],
    });
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => tmpProject,
    });
    expect(result.projectSynced).toBe(true);
    const m = readManifestFrom(tmpProject);
    expect(m.version).not.toBe("0.0.1");
  });

  test("skips project scope when no manifest exists", () => {
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => tmpProject,
    });
    // User scope gets auto-installed, project scope skipped
    expect(result.projectSynced).toBe(false);
  });

  test("preserves prefix from previous install", () => {
    writeManifestTo(tmpHome, {
      version: "0.0.1",
      prefix: "gs-",
      commands: ["gs-think.md"],
      skills: ["browser.md"],
    });
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    const m = readManifestFrom(tmpHome);
    expect(m.prefix).toBe("gs-");
    // Should have gs- prefixed skill directories (skills format)
    expect(m.skills.some((s: string) => s.startsWith("gs-think/"))).toBe(true);
  });

  test("handles gitRoot failure gracefully", () => {
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("not a git repo"); },
    });
    // User scope still works
    expect(result.userSynced).toBe(true);
    expect(result.projectSynced).toBe(false);
  });

  test("never throws on any error", () => {
    // getSettingFn throws — outer catch swallows and returns default result
    expect(() => autoSyncSkills({
      getSettingFn: () => { throw new Error("boom"); },
      homeDirFn: () => "/nonexistent/path",
      gitRootFn: () => { throw new Error("no git"); },
    })).not.toThrow();
  });

  test("returns synced=true when version differs but file content identical", () => {
    // First install to get current skill content with current version
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    // Rewrite manifest with stale version but keep files as-is
    const manifestPath = path.join(tmpHome, ".claude", ".glorious-skills.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    m.version = "0.0.1-stale";
    fs.writeFileSync(manifestPath, JSON.stringify(m));
    // Run again — files are identical, but version is stale
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    expect(result.userSynced).toBe(true);
    // Manifest version should be updated
    const m2 = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(m2.version).not.toBe("0.0.1-stale");
  });

  test("synced manifest has current version", () => {
    writeManifestTo(tmpHome, {
      version: "0.0.1",
      prefix: "",
      commands: ["think.md"],
      skills: ["browser.md"],
    });
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    const m = readManifestFrom(tmpHome);
    // Version should now match the running CLI version (not 0.0.1)
    expect(m.version).toBeDefined();
    expect(m.version).not.toBe("0.0.1");
  });

  // --- Format migration tests (Step 1.5) ---

  test("migrates from commands format to skills format on sync", () => {
    writeManifestTo(tmpHome, {
      version: "0.0.1",
      prefix: "",
      commands: ["think.md"],
      skills: ["browser.md"],
    });
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    const m = readManifestFrom(tmpHome);
    // Should now be in skills format
    expect(m.format).toBe("skills");
    // Skills should have directory-format keys
    expect(m.skills.some((s: string) => s.includes("/SKILL.md"))).toBe(true);
    // Commands should be empty
    expect(m.commands).toEqual([]);
  });

  test("triggers re-sync when version matches but format is missing", () => {
    // Install once to get current version
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    // Tamper manifest to remove format field (simulating old v2 manifest with current version)
    const manifestPath = path.join(tmpHome, ".claude", ".glorious-skills.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    delete m.format;
    fs.writeFileSync(manifestPath, JSON.stringify(m));
    // Run again — should trigger because format is missing
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    expect(result.userSynced).toBe(true);
    // Format should now be restored
    const m2 = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(m2.format).toBe("skills");
  });

  test("does not re-sync when version AND format both match", () => {
    // Install once
    autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    // Second call should skip (version + format both match)
    const result = autoSyncSkills({
      getSettingFn: () => "true",
      homeDirFn: () => tmpHome,
      gitRootFn: () => { throw new Error("no git"); },
    });
    expect(result.userSynced).toBe(false);
  });
});

// ── Skill validation tests (Step 6.1) ────────────────────────────────

describe("validateSkill", () => {
  test("passes valid SKILL.md with name and description", () => {
    const content = "---\nname: test\ndescription: A test skill\n---\n\n# Test";
    const result = validateSkill(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("fails when missing frontmatter", () => {
    const content = "# No frontmatter";
    const result = validateSkill(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("frontmatter"))).toBe(true);
  });

  test("fails when missing name field", () => {
    const content = "---\ndescription: A test\n---\n\n# Test";
    const result = validateSkill(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("name"))).toBe(true);
  });

  test("fails when missing description field", () => {
    const content = "---\nname: test\n---\n\n# Test";
    const result = validateSkill(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("description"))).toBe(true);
  });

  test("fails with malformed frontmatter (no closing ---)", () => {
    const content = "---\nname: test\ndescription: missing close";
    const result = validateSkill(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("malformed"))).toBe(true);
  });
});

describe("testTriggers", () => {
  test("passes when all trigger phrases found", () => {
    const desc = "Use when user says 'plan this' or 'create a plan'";
    const result = testTriggers(desc, ["plan this", "create a plan"], []);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("fails when trigger phrase missing", () => {
    const desc = "Use when user says 'plan this'";
    const result = testTriggers(desc, ["plan this", "missing phrase"], []);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toContain("missing phrase");
  });

  test("fails when non-trigger phrase found", () => {
    const desc = "Use when user says 'plan this' or 'build this'";
    const result = testTriggers(desc, ["plan this"], ["build this"]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("build this");
  });

  test("case-insensitive matching", () => {
    const desc = "Use when user says 'Plan This'";
    const result = testTriggers(desc, ["plan this"], []);
    expect(result.passed).toBe(true);
  });
});
