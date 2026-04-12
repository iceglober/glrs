/**
 * E2E tests for `gsag skills` install lifecycle.
 *
 * These run inside a Docker container against the real built binary,
 * exercising every install state: fresh, re-install, update, corrupt,
 * partial, scope-switch, force, and prefix.
 *
 * Each test gets an isolated temp directory simulating a git repo with
 * its own .claude/ and a fake $HOME with its own ~/.claude/.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { COMMANDS } from "../src/skills/index.js";

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

function manifest(claudeDir: string): { commands: string[]; skills: string[] } {
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

    // Manifest exists
    const m = manifest(env.projectClaude);
    expect(m.commands.length).toBeGreaterThan(0);
    expect(m.skills.length).toBeGreaterThan(0);

    // Files actually on disk
    const cmds = installedFiles(env.projectClaude, "commands");
    expect(cmds).toContain("work.md");
    expect(cmds).toContain("think.md");
    expect(cmds).toContain("ship.md");

    const skills = installedFiles(env.projectClaude, "skills");
    expect(skills).toContain("browser.md");
  });

  test("fresh install to user scope creates files in HOME", () => {
    const out = run(env, "--user");
    expect(out).toContain("created");
    expect(out).toContain("~/.claude/");

    const m = manifest(env.userClaude);
    expect(m.commands.length).toBeGreaterThan(0);

    const cmds = installedFiles(env.userClaude, "commands");
    expect(cmds).toContain("work.md");
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

    // Tamper with a file
    const workPath = path.join(env.projectClaude, "commands", "work.md");
    fs.writeFileSync(workPath, "corrupted content");

    const out = run(env, "--project");
    expect(out).toContain("updated");

    // File is repaired to exact source content
    const content = fs.readFileSync(workPath, "utf-8");
    expect(content).toBe(COMMANDS["work.md"]);
  });

  test("re-install after skill set change removes stale and adds new", () => {
    run(env, "--project");

    // Simulate a previous version that had an extra command
    const m = manifest(env.projectClaude);
    const fakeOldCmd = "deprecated-old-cmd.md";
    m.commands.push(fakeOldCmd);
    fs.writeFileSync(
      path.join(env.projectClaude, ".glorious-skills.json"),
      JSON.stringify(m, null, 2) + "\n",
    );
    // Create the stale file on disk
    fs.writeFileSync(
      path.join(env.projectClaude, "commands", fakeOldCmd),
      "# old command",
    );

    const out = run(env, "--project");
    expect(out).toContain("removed");

    // Stale file gone
    expect(
      fs.existsSync(path.join(env.projectClaude, "commands", fakeOldCmd)),
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
    expect(m.commands.length).toBeGreaterThan(0);
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
    expect(m.commands.length).toBeGreaterThan(0);
  });

  // --- Partial install (simulating crash mid-install) ---

  test("partial install (some files, no manifest) repairs on next run", () => {
    // Manually create just one command file, no manifest
    const cmdDir = path.join(env.projectClaude, "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, "work.md"), "partial content");

    const out = run(env, "--project");
    // work.md had wrong content → updated; rest → created
    expect(out).toContain("created");
    expect(out).toContain("updated");

    // Manifest now exists
    const m = manifest(env.projectClaude);
    expect(m.commands.length).toBeGreaterThan(0);
  });

  // --- Scope independence ---

  test("project and user installs are independent", () => {
    run(env, "--project");
    run(env, "--user");

    // Both have manifests
    const pm = manifest(env.projectClaude);
    const um = manifest(env.userClaude);
    expect(pm.commands.length).toBeGreaterThan(0);
    expect(um.commands.length).toBeGreaterThan(0);

    // Modifying one doesn't affect the other
    const projectWork = path.join(env.projectClaude, "commands", "work.md");
    const userWork = path.join(env.userClaude, "commands", "work.md");
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
    const workPath = path.join(env.projectClaude, "commands", "work.md");
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

    const cmds = installedFiles(env.projectClaude, "commands");
    // gs-* skills should have gs- prefix
    expect(cmds).toContain("gs-work.md");
    expect(cmds).toContain("gs-think.md");
    expect(cmds).toContain("gs-ship.md");
    // Non-gs skills unchanged
    expect(cmds).toContain("research.md");
    expect(cmds).toContain("spec-make.md");
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
