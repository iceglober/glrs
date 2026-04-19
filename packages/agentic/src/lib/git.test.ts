import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { gitRoot } from "./git.js";
import { repoName } from "./config.js";
import { TEST_GIT_ENV as GIT_ENV } from "./test-utils.js";

describe("gitRoot from a linked worktree", () => {
  let tmpBase: string;
  let primaryRoot: string;
  let worktreePath: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmpBase = fs.mkdtempSync("/tmp/gs-gitroot-");
    // realpath — /tmp is a symlink on macOS to /private/tmp
    tmpBase = fs.realpathSync(tmpBase);
    primaryRoot = path.join(tmpBase, "kn-eng");
    fs.mkdirSync(primaryRoot, { recursive: true });

    execSync("git init", { cwd: primaryRoot, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", {
      cwd: primaryRoot,
      stdio: "pipe",
      env: GIT_ENV,
    });

    worktreePath = path.join(tmpBase, "worktrees", "wt-A");
    execSync(`git worktree add -b feature-A "${worktreePath}"`, {
      cwd: primaryRoot,
      stdio: "pipe",
      env: GIT_ENV,
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  test("gitRoot() returns the primary clone root, not the linked worktree path", () => {
    process.chdir(worktreePath);
    expect(gitRoot()).toBe(primaryRoot);
  });

  test("repoName() returns the primary clone's basename from inside a linked worktree", () => {
    process.chdir(worktreePath);
    expect(repoName()).toBe("kn-eng");
  });

  test("gitRoot() still returns the repo root when called from the primary clone", () => {
    process.chdir(primaryRoot);
    expect(gitRoot()).toBe(primaryRoot);
  });
});
