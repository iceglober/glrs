import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { autoName, assertPrimaryClone } from "./worktree.js";
import { TEST_GIT_ENV as GIT_ENV } from "./test-utils.js";

describe("autoName", () => {
  it("produces a wt-YYMMDD-HHMMSS-<suffix> slug", () => {
    const fixed = new Date("2026-04-19T13:07:42");
    expect(autoName(fixed, "abc")).toBe("wt-260419-130742-abc");
  });

  it("zero-pads single digits", () => {
    const fixed = new Date("2026-01-02T03:04:05");
    expect(autoName(fixed, "zzz")).toBe("wt-260102-030405-zzz");
  });

  it("sorts lexically by time when suffix is stable", () => {
    const a = autoName(new Date("2026-04-19T10:00:00"), "aaa");
    const b = autoName(new Date("2026-04-19T11:00:00"), "aaa");
    expect(a < b).toBe(true);
  });

  it("includes a random suffix by default for collision resistance", () => {
    const fixed = new Date("2026-04-19T13:07:42");
    const a = autoName(fixed);
    expect(a).toMatch(/^wt-260419-130742-[a-z0-9]{3}$/);
  });
});

describe("assertPrimaryClone", () => {
  let tmpBase: string;
  let primaryRoot: string;
  let worktreePath: string;

  beforeEach(() => {
    tmpBase = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gs-primaryclone-")),
    );
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
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it("accepts the primary clone", () => {
    expect(() => assertPrimaryClone(primaryRoot)).not.toThrow();
  });

  it("rejects a linked worktree with a helpful error", () => {
    expect(() => assertPrimaryClone(worktreePath)).toThrow(
      /Refusing to create a nested worktree/,
    );
  });

  it("is a no-op when given a non-git directory (deferred to later git call)", () => {
    const plain = path.join(tmpBase, "plain-dir");
    fs.mkdirSync(plain);
    expect(() => assertPrimaryClone(plain)).not.toThrow();
  });
});
