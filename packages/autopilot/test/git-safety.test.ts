/**
 * Tests for phase-level git safety helpers.
 *
 * DI-based tests verifying:
 *   - recordHead returns the trimmed git SHA on success
 *   - recordHead returns "HEAD" on any git failure (never throws)
 *   - resetSoft invokes `git reset --soft <sha>` on success
 *   - resetSoft refuses to run on empty / "HEAD" sha
 *   - resetSoft swallows git failures and returns false
 */

import { describe, it, expect } from "bun:test";
import { recordHead, resetSoft, type GitSafetyDeps } from "../src/git-safety.js";

describe("recordHead", () => {
  it("returns the trimmed SHA from git rev-parse HEAD", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const deps: GitSafetyDeps = {
      execGit: async (args, cwd) => {
        calls.push({ args, cwd });
        return { stdout: "abc123def\n", stderr: "" };
      },
    };
    const sha = await recordHead("/tmp/repo", deps);
    expect(sha).toBe("abc123def");
    expect(calls).toEqual([{ args: ["rev-parse", "HEAD"], cwd: "/tmp/repo" }]);
  });

  it("returns 'HEAD' when git fails", async () => {
    const deps: GitSafetyDeps = {
      execGit: async () => {
        throw new Error("not a git repo");
      },
    };
    const sha = await recordHead("/tmp/no-repo", deps);
    expect(sha).toBe("HEAD");
  });
});

describe("resetSoft", () => {
  it("invokes `git reset --soft <sha>` and returns true on success", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const deps: GitSafetyDeps = {
      execGit: async (args, cwd) => {
        calls.push({ args, cwd });
        return { stdout: "", stderr: "" };
      },
    };
    const ok = await resetSoft("/tmp/repo", "abc123", deps);
    expect(ok).toBe(true);
    expect(calls).toEqual([
      { args: ["reset", "--soft", "abc123"], cwd: "/tmp/repo" },
    ]);
  });

  it("returns false and warns when sha is empty", async () => {
    const warns: string[] = [];
    const calls: Array<unknown> = [];
    const deps = {
      execGit: async (args: string[], cwd: string) => {
        calls.push({ args, cwd });
        return { stdout: "", stderr: "" };
      },
      onWarn: (m: string) => warns.push(m),
    };
    const ok = await resetSoft("/tmp/repo", "", deps);
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("invalid sha");
  });

  it('returns false and warns when sha is "HEAD"', async () => {
    const calls: Array<unknown> = [];
    const ok = await resetSoft("/tmp/repo", "HEAD", {
      execGit: async (args, cwd) => {
        calls.push({ args, cwd });
        return { stdout: "", stderr: "" };
      },
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("swallows git failures, returns false, and reports via onWarn", async () => {
    const warns: string[] = [];
    const ok = await resetSoft("/tmp/repo", "abc123", {
      execGit: async () => {
        throw new Error("permission denied");
      },
      onWarn: (m) => warns.push(m),
    });
    expect(ok).toBe(false);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("resetSoft failed");
    expect(warns[0]).toContain("permission denied");
  });
});
