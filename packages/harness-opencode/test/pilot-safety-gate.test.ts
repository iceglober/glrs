// pilot-safety-gate.test.ts — tests for src/pilot/worker/safety-gate.ts.
//
// Exercises checkCwdSafety() against real tmp git repos. Covers acceptance
// criteria a1 (branch refusal) and a2 (dirty-tree refusal).

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkCwdSafety, headSha } from "../src/pilot/worker/safety-gate.js";

// --- Fixtures --------------------------------------------------------------

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-safety-gate-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function mkRepo(branch: string): string {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-b", branch, "--quiet", repo], {
    stdio: "ignore",
  });
  git(repo, "config", "user.email", "t@e.com");
  git(repo, "config", "user.name", "T");
  git(repo, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "README.md"), "x");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "init", "--quiet");
  return repo;
}

// --- Tests ----------------------------------------------------------------

describe("checkCwdSafety — branch rules (a1)", () => {
  test("checkCwdSafety rejects main branch", async () => {
    const repo = mkRepo("main");
    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/main/);
    expect(result.reason).toMatch(/protected|feature branch/);
  });

  test("checkCwdSafety rejects master branch", async () => {
    const repo = mkRepo("master");
    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/master/);
  });

  test("checkCwdSafety rejects remote-default branch when origin/HEAD is set", async () => {
    // Set up a repo on branch "develop" with origin/HEAD → origin/develop.
    const repo = mkRepo("develop");
    // Fake a remote by adding a self-remote that points back to the repo.
    // `git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/develop`
    // works without a real remote as long as the ref exists.
    fs.mkdirSync(path.join(repo, ".git", "refs", "remotes", "origin"), {
      recursive: true,
    });
    // Write the remote branch ref to point at HEAD.
    const headSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(
      path.join(repo, ".git", "refs", "remotes", "origin", "develop"),
      headSha + "\n",
    );
    // Set origin/HEAD symbolic ref.
    execFileSync(
      "git",
      [
        "-C",
        repo,
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/develop",
      ],
      { stdio: "ignore" },
    );

    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/default branch|develop/);
  });

  test("checkCwdSafety accepts a feature branch with a clean tree", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/test");
    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(true);
  });
});

describe("checkCwdSafety — dirty-tree rules (a2)", () => {
  test("checkCwdSafety rejects dirty tracked changes", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/dirty");
    fs.writeFileSync(path.join(repo, "README.md"), "modified");
    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/dirty|uncommitted/);
  });

  test("checkCwdSafety rejects untracked non-ignored files", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/untracked");
    fs.writeFileSync(path.join(repo, "new.txt"), "new");
    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/dirty|uncommitted/);
  });

  test("checkCwdSafety accepts clean tree with ignored files", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/ignored");
    fs.writeFileSync(path.join(repo, ".gitignore"), "debug.log\n");
    git(repo, "add", ".gitignore");
    git(repo, "commit", "-m", "gitignore", "--quiet");
    // Now write a gitignored file.
    fs.writeFileSync(path.join(repo, "debug.log"), "debug info");
    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(true);
  });
});

describe("checkCwdSafety — SAFETY_GATE_TOLERATE (framework noise)", () => {
  test("tolerates .opencode/package.json churn with a warning", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/opencode-dirt");
    fs.mkdirSync(path.join(repo, ".opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".opencode", "package.json"),
      JSON.stringify({ name: ".opencode", dependencies: {} }),
    );
    git(repo, "add", ".opencode/package.json");
    git(repo, "commit", "-m", "add opencode", "--quiet");
    // Now simulate the opencode auto-update: modify package.json.
    fs.writeFileSync(
      path.join(repo, ".opencode", "package.json"),
      JSON.stringify({ name: ".opencode", dependencies: { foo: "1.0.0" } }),
    );

    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/\.opencode\/package\.json/);
    expect(result.warnings[0]).toMatch(/framework-owned/);
  });

  test("tolerates next-env.d.ts churn without refusing", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/next-dirt");
    fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "apps", "web", "next-env.d.ts"),
      "/// <reference types=\"next\" />\n",
    );
    git(repo, "add", "apps/web/next-env.d.ts");
    git(repo, "commit", "-m", "init next-env", "--quiet");
    fs.writeFileSync(
      path.join(repo, "apps", "web", "next-env.d.ts"),
      "/// <reference types=\"next\" />\nimport \"./.next/types/routes.d.ts\";\n",
    );

    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings[0]).toMatch(/next-env\.d\.ts/);
  });

  test("still refuses when dirt mixes tolerated + genuine paths", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/mixed-dirt");
    fs.mkdirSync(path.join(repo, ".opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".opencode", "package.json"),
      JSON.stringify({ name: ".opencode" }),
    );
    fs.writeFileSync(path.join(repo, "src.txt"), "initial");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "init", "--quiet");
    // Dirty a tolerated path AND a non-tolerated path.
    fs.writeFileSync(
      path.join(repo, ".opencode", "package.json"),
      JSON.stringify({ name: ".opencode", dependencies: { foo: "1" } }),
    );
    fs.writeFileSync(path.join(repo, "src.txt"), "user-edit");

    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Error message should mention the genuine dirty file, not swallow it.
    expect(result.reason).toMatch(/src\.txt/);
  });

  test("warning truncates when many tolerated files are dirty", async () => {
    const repo = mkRepo("main");
    git(repo, "checkout", "-b", "feat/many-tolerated");
    fs.mkdirSync(path.join(repo, ".opencode"), { recursive: true });
    // 8 tolerated files.
    for (let i = 0; i < 8; i++) {
      fs.writeFileSync(
        path.join(repo, ".opencode", `f${i}.json`),
        JSON.stringify({ i }),
      );
    }
    git(repo, "add", ".");
    git(repo, "commit", "-m", "init", "--quiet");
    // Modify all of them.
    for (let i = 0; i < 8; i++) {
      fs.writeFileSync(
        path.join(repo, ".opencode", `f${i}.json`),
        JSON.stringify({ i, updated: true }),
      );
    }

    const result = await checkCwdSafety(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Preview lists first 5, suffix notes the rest.
    expect(result.warnings[0]).toMatch(/\+3 more/);
  });
});

describe("checkCwdSafety — not-a-repo", () => {
  test("checkCwdSafety rejects a directory outside a git worktree", async () => {
    const notRepo = path.join(tmp, "not-a-repo");
    fs.mkdirSync(notRepo);
    const result = await checkCwdSafety(notRepo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not inside a git worktree/);
  });
});

describe("headSha", () => {
  test("returns the HEAD sha for a valid repo", async () => {
    const repo = mkRepo("main");
    const sha = await headSha(repo);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("throws on a non-git directory", async () => {
    const notRepo = path.join(tmp, "not-a-repo");
    fs.mkdirSync(notRepo);
    await expect(headSha(notRepo)).rejects.toThrow();
  });
});
