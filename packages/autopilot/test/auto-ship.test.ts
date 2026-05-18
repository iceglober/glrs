/**
 * Tests for the auto-ship module (item 4.7).
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { autoShip } from "../src/auto-ship.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "auto-ship-test-"));
}

interface ExecCall {
  cmd: string;
  args: readonly string[];
}

function makeFakeExec(
  responses: Record<string, { stdout?: string; throw?: Error }>,
): { calls: ExecCall[]; exec: (...a: unknown[]) => Promise<unknown> } {
  const calls: ExecCall[] = [];
  const exec = (async (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args });
    const key = `${cmd} ${(args ?? []).slice(0, 2).join(" ")}`;
    const resp =
      responses[key] ??
      responses[cmd] ??
      ({ stdout: "" } as {
        stdout?: string;
        throw?: Error;
      });
    if (resp.throw) throw resp.throw;
    return { stdout: resp.stdout ?? "", stderr: "" };
  }) as never;
  return { calls, exec };
}

describe("autoShip", () => {
  it("aborts when current branch is main", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "plan.md"), "# Title\n");
    const { exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "main\n" },
    });
    await expect(
      autoShip({
        planPath: path.join(dir, "plan.md"),
        repoRoot: dir,
        _deps: { execFile: exec as never },
      }),
    ).rejects.toThrow(/forbidden branch/);
  });

  it("aborts when current branch is master", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "plan.md"), "# Title\n");
    const { exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "master\n" },
    });
    await expect(
      autoShip({
        planPath: path.join(dir, "plan.md"),
        repoRoot: dir,
        _deps: { execFile: exec as never },
      }),
    ).rejects.toThrow(/forbidden branch/);
  });

  it("aborts on detached HEAD", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "plan.md"), "# Title\n");
    const { exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "HEAD\n" },
    });
    await expect(
      autoShip({
        planPath: path.join(dir, "plan.md"),
        repoRoot: dir,
        _deps: { execFile: exec as never },
      }),
    ).rejects.toThrow(/detached HEAD/);
  });

  it("pushes the branch and opens a PR with the plan's H1", async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "plan.md"),
      "# My Feature Branch\n\n## Goal\n\nDo it.\n",
    );
    const { calls, exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "feat/my-feature\n" },
      "git push -u": { stdout: "" },
      "gh pr create": {
        stdout: "https://github.com/owner/repo/pull/42\n",
      },
    });

    const result = await autoShip({
      planPath: path.join(dir, "plan.md"),
      repoRoot: dir,
      _deps: { execFile: exec as never },
    });

    expect(result.branch).toBe("feat/my-feature");
    expect(result.title).toBe("My Feature Branch");
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");

    // Verify the push command shape — no --force, no --no-verify.
    const pushCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "push",
    );
    expect(pushCall?.args).toEqual(["push", "-u", "origin", "feat/my-feature"]);
    expect(pushCall?.args).not.toContain("--force");
    expect(pushCall?.args).not.toContain("-f");
    expect(pushCall?.args).not.toContain("--no-verify");

    // Verify gh shape — body-file (not body), title from H1.
    const ghCall = calls.find((c) => c.cmd === "gh");
    expect(ghCall?.args[0]).toBe("pr");
    expect(ghCall?.args[1]).toBe("create");
    expect(ghCall?.args).toContain("--title");
    expect(ghCall?.args).toContain("--body-file");
    expect(ghCall?.args).toContain("My Feature Branch");
  });

  it("uses main.md from a directory plan", async () => {
    const dir = tmpDir();
    const planDir = path.join(dir, "plan");
    fs.mkdirSync(planDir);
    fs.writeFileSync(path.join(planDir, "main.md"), "# Multi-file Plan\n");

    const { calls, exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "feat/multi\n" },
      "git push -u": { stdout: "" },
      "gh pr create": { stdout: "https://x/y/1\n" },
    });

    const result = await autoShip({
      planPath: planDir,
      repoRoot: dir,
      _deps: { execFile: exec as never },
    });

    expect(result.title).toBe("Multi-file Plan");
    const ghCall = calls.find((c) => c.cmd === "gh");
    const bodyFileIdx = ghCall?.args.indexOf("--body-file") ?? -1;
    expect(ghCall?.args[bodyFileIdx + 1]).toBe(path.join(planDir, "main.md"));
  });

  it("propagates push failures with a clear error", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "plan.md"), "# Title\n");
    const { exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "feat/x\n" },
      "git push -u": { throw: new Error("non-fast-forward") },
    });
    await expect(
      autoShip({
        planPath: path.join(dir, "plan.md"),
        repoRoot: dir,
        _deps: { execFile: exec as never },
      }),
    ).rejects.toThrow(/git push failed/);
  });

  it("propagates gh failures with a clear error", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "plan.md"), "# Title\n");
    const { exec } = makeFakeExec({
      "git rev-parse --abbrev-ref": { stdout: "feat/x\n" },
      "git push -u": { stdout: "" },
      "gh pr create": {
        throw: new Error("PR already exists for branch feat/x"),
      },
    });
    await expect(
      autoShip({
        planPath: path.join(dir, "plan.md"),
        repoRoot: dir,
        _deps: { execFile: exec as never },
      }),
    ).rejects.toThrow(/gh pr create failed/);
  });
});
