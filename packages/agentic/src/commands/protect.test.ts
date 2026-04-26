import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { POST_CHECKOUT_HOOK } from "./protect.js";
import { TEST_GIT_ENV as GIT_ENV } from "../lib/test-utils.js";

describe("post-checkout hook body", () => {
  let tmpBase: string;
  let primaryRoot: string;
  let hookPath: string;

  beforeEach(() => {
    tmpBase = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gs-protect-")),
    );
    primaryRoot = path.join(tmpBase, "primary");
    fs.mkdirSync(primaryRoot, { recursive: true });
    execSync("git init", { cwd: primaryRoot, stdio: "pipe" });
    execSync("git commit --allow-empty -m init", {
      cwd: primaryRoot,
      stdio: "pipe",
      env: GIT_ENV,
    });

    // Install the hook locally into the primary repo so it fires on worktree add.
    const gitHookDir = execSync("git rev-parse --git-path hooks", {
      cwd: primaryRoot,
      env: GIT_ENV,
    })
      .toString()
      .trim();
    const resolvedHookDir = path.isAbsolute(gitHookDir)
      ? gitHookDir
      : path.join(primaryRoot, gitHookDir);
    fs.mkdirSync(resolvedHookDir, { recursive: true });
    hookPath = path.join(resolvedHookDir, "post-checkout");
    fs.writeFileSync(hookPath, POST_CHECKOUT_HOOK, { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  test("warns when a worktree is created inside another git repo", () => {
    // Nest a new worktree inside the primary repo itself (which is a git repo),
    // so the hook's ancestor-walk finds `.git` above the new worktree.
    const nested = path.join(primaryRoot, "nested-wt");
    const result = execSync(
      `git worktree add -b nested-branch "${nested}" 2>&1 || true`,
      { cwd: primaryRoot, env: GIT_ENV },
    ).toString();
    expect(result).toMatch(/nested worktree detected/);
  });

  test("stays silent when a worktree is created outside any other repo", () => {
    const sibling = path.join(tmpBase, "sibling-wt");
    const result = execSync(
      `git worktree add -b sibling-branch "${sibling}" 2>&1`,
      { cwd: primaryRoot, env: GIT_ENV },
    ).toString();
    expect(result).not.toMatch(/nested worktree detected/);
  });

  test("no-ops on file-level checkouts (checkout-type != 1)", () => {
    // Running the hook script directly with checkout-type=0 should produce no output.
    const out = execSync(`"${hookPath}" abc123 def456 0 2>&1 || true`, {
      cwd: primaryRoot,
    }).toString();
    expect(out).toBe("");
  });
});
