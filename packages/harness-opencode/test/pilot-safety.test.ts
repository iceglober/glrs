/**
 * Tests for pilot v2 safety gate.
 */

import { describe, test, expect } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkSafety, headSha } from "../src/pilot/safety.js";

const execFileP = promisify(execFile);

async function makeGitRepo(opts: { branch?: string; dirty?: boolean } = {}): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-safety-test-"));
  await execFileP("git", ["init", "-b", opts.branch ?? "feat/test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  // Need at least one commit for HEAD to exist
  fs.writeFileSync(path.join(dir, "README.md"), "test");
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-m", "init"], { cwd: dir });
  if (opts.dirty) {
    fs.writeFileSync(path.join(dir, "dirty.txt"), "uncommitted");
  }
  return dir;
}

describe("pilot safety gate", () => {
  test("passes on a clean feature branch", async () => {
    const dir = await makeGitRepo({ branch: "feat/my-feature" });
    const result = await checkSafety(dir);
    expect(result.ok).toBe(true);
  });

  test("rejects when not in a git repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-safety-nogit-"));
    const result = await checkSafety(dir);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain("git repository");
  });

  test("rejects on main branch", async () => {
    const dir = await makeGitRepo({ branch: "main" });
    const result = await checkSafety(dir);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain("main");
  });

  test("rejects on master branch", async () => {
    const dir = await makeGitRepo({ branch: "master" });
    const result = await checkSafety(dir);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain("master");
  });

  test("rejects with dirty working tree", async () => {
    const dir = await makeGitRepo({ branch: "feat/test", dirty: true });
    const result = await checkSafety(dir);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain("dirty");
  });

  test("headSha returns a SHA on a repo with commits", async () => {
    const dir = await makeGitRepo({ branch: "feat/test" });
    const sha = await headSha(dir);
    expect(sha).not.toBeNull();
    expect(sha!.length).toBe(40);
  });

  test("headSha returns null outside a git repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-safety-nosha-"));
    const sha = await headSha(dir);
    expect(sha).toBeNull();
  });
});
