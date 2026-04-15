/**
 * E2E tests for `gsag skills` install lifecycle.
 *
 * These run against the real built binary, exercising every install state:
 * fresh, re-install, update, corrupt, partial, scope-switch, force, and prefix.
 *
 * Each test gets an isolated temp directory simulating a git repo with
 * its own .claude/ and a fake $HOME with its own ~/.claude/.
 *
 * v3 skills format: all files go to .claude/skills/<name>/SKILL.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { buildAllSkills } from "../src/skills/index.js";

const CLI = path.resolve(import.meta.dir, "../dist/index.js");

interface Env {
  projectDir: string; // fake git repo root
  homeDir: string; // fake HOME
  projectClaude: string; // projectDir/.claude
  userClaude: string; // homeDir/.claude
}

function setup(): Env {
  const base = fs.mkdtempSync("/tmp/gs-e2e-");
  const projectDir = path.join(base, "repo");
  const homeDir = path.join(base, "home");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  // Disable auto-sync so explicit install tests are isolated from autoSyncSkills()
  const settingsDir = path.join(homeDir, ".glorious");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, "settings.json"),
    JSON.stringify({ "skills.auto-update": "false" }),
  );

  // Init a bare git repo so gitRoot() works
  execSync("git init", { cwd: projectDir, stdio: "pipe" });
  execSync("git commit --allow-empty -m init", {
    cwd: projectDir,
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: homeDir,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });

  return {
    projectDir,
    homeDir,
    projectClaude: path.join(projectDir, ".claude"),
    userClaude: path.join(homeDir, ".claude"),
  };
}

function run(env: Env, flags: string = ""): string {
  return execSync(`node ${CLI} skills ${flags}`, {
    cwd: env.projectDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: env.homeDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function manifest(claudeDir: string): { commands: string[]; skills: string[]; format?: string } {
  const p = path.join(claudeDir, ".glorious-skills.json");
  if (!fs.existsSync(p)) return { commands: [], skills: [] };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function installedFiles(claudeDir: string, subdir: string): string[] {
  const dir = path.join(claudeDir, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("e2e: gsag skills", () => {
  let env: Env;

  beforeEach(() => {
    env = setup();
  });

  // --- Fresh install states ---

  test("fresh install to project scope creates all files and manifest", () => {
    const out = run(env, "--project");
    expect(out).toContain("created");
    expect(out).toContain(".claude/");

    // Manifest exists with skills format
    const m = manifest(env.projectClaude);
    expect(m.format).toBe("skills");
    expect(m.skills.length).toBeGreaterThan(0);
    expect(m.commands.length).toBe(0);

    // Files in skills/ directory (v3 format)
    const skills = installedFiles(env.projectClaude, "skills");
    expect(skills).toContain(path.join("work", "SKILL.md"));
    expect(skills).toContain(path.join("think", "SKILL.md"));
    expect(skills).toContain(path.join("ship", "SKILL.md"));
    expect(skills).toContain(path.join("browser", "SKILL.md"));
  });

  test("fresh install to user scope creates files in HOME", () => {
    const out = run(env, "--user");
    expect(out).toContain("created");
    expect(out).toContain("~/.claude/");

    const m = manifest(env.userClaude);
    expect(m.format).toBe("skills");
    expect(m.skills.length).toBeGreaterThan(0);

    const skills = installedFiles(env.userClaude, "skills");
    expect(skills).toContain(path.join("work", "SKILL.md"));
  });

  // --- Re-install (idempotent) ---

  test("re-install with no changes reports up-to-date", () => {
    run(env, "--project");
    const out = run(env, "--project");
    expect(out).toContain("all skills up to date");
  });

  // --- Update / repair ---

  test("re-install repairs a tampered file", () => {
    run(env, "--project");

    // Tamper with a skill file
    const workPath = path.join(env.projectClaude, "skills", "work", "SKILL.md");
    fs.writeFileSync(workPath, "corrupted content");

    const out = run(env, "--project");
    expect(out).toContain("updated");

    // File is repaired to exact source content
    const content = fs.readFileSync(workPath, "utf-8");
    const expected = buildAllSkills();
    expect(content).toBe(expected["work/SKILL.md"]);
  });

  test("re-install after skill set change removes stale and adds new", () => {
    run(env, "--project");

    // Simulate a previous version that had an extra skill
    const m = manifest(env.projectClaude);
    const fakeOldSkill = "deprecated-old-skill/SKILL.md";
    m.skills.push(fakeOldSkill);
    fs.writeFileSync(
      path.join(env.projectClaude, ".glorious-skills.json"),
      JSON.stringify(m, null, 2) + "\n",
    );
    // Create the stale file on disk
    const staleDir = path.join(env.projectClaude, "skills", "deprecated-old-skill");
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, "SKILL.md"), "# old skill");

    const out = run(env, "--project");
    expect(out).toContain("removed");

    // Stale file gone
    expect(
      fs.existsSync(path.join(staleDir, "SKILL.md")),
    ).toBe(false);
  });

  // --- Corrupted manifest ---

  test("corrupted manifest (invalid JSON) allows clean re-install", () => {
    run(env, "--project");

    // Corrupt the manifest
    fs.writeFileSync(
      path.join(env.projectClaude, ".glorious-skills.json"),
      "NOT VALID JSON {{{",
    );

    // Should not throw, should re-install successfully
    const out = run(env, "--project");
    // All files already on disk match → up to date (manifest was just corrupt)
    expect(out).toContain("all skills up to date");

    // Manifest is now valid again
    const m = manifest(env.projectClaude);
    expect(m.skills.length).toBeGreaterThan(0);
  });

  test("missing manifest with existing files still installs cleanly", () => {
    run(env, "--project");

    // Delete manifest but leave files
    fs.unlinkSync(path.join(env.projectClaude, ".glorious-skills.json"));

    const out = run(env, "--project");
    // Files already match → up to date
    expect(out).toContain("all skills up to date");

    // Manifest recreated
    expect(
      fs.existsSync(path.join(env.projectClaude, ".glorious-skills.json")),
    ).toBe(true);
  });

  test("empty manifest file allows clean re-install", () => {
    run(env, "--project");

    // Write empty file
    fs.writeFileSync(
      path.join(env.projectClaude, ".glorious-skills.json"),
      "",
    );

    const out = run(env, "--project");
    expect(out).toContain("all skills up to date");

    const m = manifest(env.projectClaude);
    expect(m.skills.length).toBeGreaterThan(0);
  });

  // --- Partial install (simulating crash mid-install) ---

  test("partial install (some files, no manifest) repairs on next run", () => {
    // Manually create just one skill file, no manifest
    const skillDir = path.join(env.projectClaude, "skills", "work");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "partial content");

    const out = run(env, "--project");
    // work/SKILL.md had wrong content → updated; rest → created
    expect(out).toContain("created");
    expect(out).toContain("updated");

    // Manifest now exists
    const m = manifest(env.projectClaude);
    expect(m.skills.length).toBeGreaterThan(0);
  });

  // --- Scope independence ---

  test("project and user installs are independent", () => {
    run(env, "--project");
    run(env, "--user");

    // Both have manifests
    const pm = manifest(env.projectClaude);
    const um = manifest(env.userClaude);
    expect(pm.skills.length).toBeGreaterThan(0);
    expect(um.skills.length).toBeGreaterThan(0);

    // Modifying one doesn't affect the other
    const projectWork = path.join(env.projectClaude, "skills", "work", "SKILL.md");
    const userWork = path.join(env.userClaude, "skills", "work", "SKILL.md");
    fs.writeFileSync(projectWork, "tampered");

    run(env, "--project");
    // Project repaired
    expect(fs.readFileSync(projectWork, "utf-8")).not.toBe("tampered");
    // User untouched (still the original content)
    const userContent = fs.readFileSync(userWork, "utf-8");
    run(env, "--user");
    expect(fs.readFileSync(userWork, "utf-8")).toBe(userContent);
  });

  // --- Force ---

  test("--force overwrites even when content matches", () => {
    run(env, "--project");
    // Get mtime of a file
    const workPath = path.join(env.projectClaude, "skills", "work", "SKILL.md");
    const mtime1 = fs.statSync(workPath).mtimeMs;

    // Small delay to ensure mtime changes
    execSync("sleep 0.1");

    const out = run(env, "--project --force");
    expect(out).toContain("updated");

    const mtime2 = fs.statSync(workPath).mtimeMs;
    expect(mtime2).toBeGreaterThan(mtime1);
  });

  // --- Prefix ---

  test("--prefix gs- installs with gs- prefixed names", () => {
    run(env, "--project --prefix gs-");

    const skills = installedFiles(env.projectClaude, "skills");
    // gs-* skills should have gs- prefix in directory name
    expect(skills).toContain(path.join("gs-work", "SKILL.md"));
    expect(skills).toContain(path.join("gs-think", "SKILL.md"));
    expect(skills).toContain(path.join("gs-ship", "SKILL.md"));
    // Non-gs skills unchanged
    expect(skills).toContain(path.join("research", "SKILL.md"));
    expect(skills).toContain(path.join("spec-make", "SKILL.md"));
  });

  // --- Non-TTY fallback ---

  test("piped stdin falls back to project scope", () => {
    const out = execSync(`echo "" | node ${CLI} skills`, {
      cwd: env.projectDir,
      encoding: "utf-8",
      env: { ...process.env, HOME: env.homeDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(out).toContain("created");
    expect(out).toContain(".claude/");

    // Installed to project, not user
    expect(fs.existsSync(path.join(env.projectClaude, ".glorious-skills.json"))).toBe(true);
    expect(fs.existsSync(path.join(env.userClaude, ".glorious-skills.json"))).toBe(false);
  });

  // --- Mutual exclusion ---

  test("--user --project errors", () => {
    expect(() => run(env, "--user --project")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// autoSyncSkills e2e tests
// ---------------------------------------------------------------------------

/** Setup WITHOUT auto-sync disabled — auto-sync fires on every CLI invocation. */
function setupAutoSync(): Env {
  const base = fs.mkdtempSync("/tmp/gs-e2e-autosync-");
  const projectDir = path.join(base, "repo");
  const homeDir = path.join(base, "home");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  // NO settings.json → auto-sync defaults to enabled

  execSync("git init", { cwd: projectDir, stdio: "pipe" });
  execSync("git commit --allow-empty -m init", {
    cwd: projectDir,
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: homeDir,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });

  return {
    projectDir,
    homeDir,
    projectClaude: path.join(projectDir, ".claude"),
    userClaude: path.join(homeDir, ".claude"),
  };
}

/** Run any CLI command and capture both stdout and stderr. */
function runCapture(env: Env, args: string): { stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, ...args.split(/\s+/)], {
    cwd: env.projectDir,
    encoding: "utf-8",
    env: { ...process.env, HOME: env.homeDir },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("e2e: autoSyncSkills", () => {
  let env: Env;

  beforeEach(() => {
    env = setupAutoSync();
  });

  afterEach(() => {
    const base = path.dirname(env.projectDir);
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true });
  });

  test("auto-installs to user scope on first CLI invocation", () => {
    const { stderr } = runCapture(env, "config list");
    expect(stderr).toContain("skills synced");
    // User scope manifest created
    const m = manifest(env.userClaude);
    expect(m.skills.length).toBeGreaterThan(0);
    // Files on disk
    const skills = installedFiles(env.userClaude, "skills");
    expect(skills).toContain(path.join("work", "SKILL.md"));
  });

  test("does not auto-install when skills.auto-update is false", () => {
    // Write settings to disable auto-sync
    const settingsDir = path.join(env.homeDir, ".glorious");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({ "skills.auto-update": "false" }),
    );

    const { stderr } = runCapture(env, "config list");
    expect(stderr).not.toContain("skills synced");
    // No user scope manifest
    expect(fs.existsSync(path.join(env.userClaude, ".glorious-skills.json"))).toBe(false);
  });

  test("does not sync when version already matches", () => {
    // First run triggers auto-sync
    runCapture(env, "config list");
    // Second run should skip — version already matches
    const { stderr } = runCapture(env, "config list");
    expect(stderr).not.toContain("skills synced");
  });

  test("syncs project scope when manifest version is stale", () => {
    // Install to project scope explicitly (with auto-sync disabled to isolate)
    const settingsDir = path.join(env.homeDir, ".glorious");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({ "skills.auto-update": "false" }),
    );
    run(env, "--project");

    // Change project manifest version to stale
    const manifestPath = path.join(env.projectClaude, ".glorious-skills.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    m.version = "0.0.1";
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));

    // Re-enable auto-sync by removing the settings file
    fs.unlinkSync(path.join(settingsDir, "settings.json"));

    // Run any command — auto-sync should fire for project scope
    const { stderr } = runCapture(env, "config list");
    expect(stderr).toContain("skills synced");
    expect(stderr).toContain(".claude/");

    // Project manifest version should be updated
    const m2 = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(m2.version).not.toBe("0.0.1");
  });

  test("preserves prefix during user scope auto-sync", () => {
    // Install to user scope with prefix (with auto-sync disabled to isolate)
    const settingsDir = path.join(env.homeDir, ".glorious");
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify({ "skills.auto-update": "false" }),
    );
    run(env, "--user --prefix gs-");

    // Change user manifest version to stale
    const manifestPath = path.join(env.userClaude, ".glorious-skills.json");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(m.prefix).toBe("gs-");
    m.version = "0.0.1";
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));

    // Re-enable auto-sync
    fs.unlinkSync(path.join(settingsDir, "settings.json"));

    // Run any command — auto-sync fires (version mismatch triggers syncScope)
    // Note: "skills synced" only prints when files actually change. Since the same
    // binary installed them, file content is identical — no stderr output expected.
    runCapture(env, "config list");

    // Manifest version updated from stale "0.0.1" to current
    const m2 = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(m2.version).not.toBe("0.0.1");

    // Prefix preserved
    expect(m2.prefix).toBe("gs-");

    // Files still have gs- prefix
    const skills = installedFiles(env.userClaude, "skills");
    expect(skills).toContain(path.join("gs-work", "SKILL.md"));
  });
});
