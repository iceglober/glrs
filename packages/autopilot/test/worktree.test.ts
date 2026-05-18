/**
 * Tests for the worktree module (item 3.2).
 *
 * All git invocations are mocked via the `_deps.execFile` injection point.
 * No real git operations are performed.
 */

import { describe, it, expect } from "bun:test";
import { createWorktree, mergeWorktree } from "../src/worktree.js";

interface ExecCall {
  file: string;
  args: readonly string[];
  cwd?: string;
}

/**
 * Builds an execFile mock that records every call and returns either
 * a stdout/stderr pair or throws an Error with stdout/stderr attached.
 */
function makeExec(
  responses: Array<
    | { stdout: string; stderr?: string }
    | { reject: { message?: string; stdout?: string; stderr?: string } }
  >,
): {
  exec: any;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  let i = 0;
  const exec = async (
    file: string,
    args: readonly string[],
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string }> => {
    calls.push({ file, args: [...args], cwd: options?.cwd });
    const r = responses[i++] ?? { stdout: "", stderr: "" };
    if ("reject" in r) {
      const err = new Error(r.reject.message ?? "exec failed") as Error & {
        stdout?: string;
        stderr?: string;
      };
      err.stdout = r.reject.stdout ?? "";
      err.stderr = r.reject.stderr ?? "";
      throw err;
    }
    return { stdout: r.stdout, stderr: r.stderr ?? "" };
  };
  return { exec, calls };
}

describe("createWorktree", () => {
  it("invokes `git worktree add <path> -b autopilot/<slug>` against repoRoot", async () => {
    const { exec, calls } = makeExec([{ stdout: "" }]);
    const handle = await createWorktree("/repo", {
      laneSlug: "wave_1",
      _deps: { execFile: exec },
    });

    expect(calls.length).toBe(1);
    expect(calls[0].file).toBe("git");
    expect(calls[0].args[0]).toBe("worktree");
    expect(calls[0].args[1]).toBe("add");
    expect(calls[0].args[2]).toMatch(/^\/repo\/\.agent\/worktrees\/wave_1-\d+$/);
    expect(calls[0].args[3]).toBe("-b");
    expect(calls[0].args[4]).toBe("autopilot/wave_1");
    expect(calls[0].cwd).toBe("/repo");

    expect(handle.path).toMatch(/^\/repo\/\.agent\/worktrees\/wave_1-\d+$/);
    expect(handle.branch).toBe("autopilot/wave_1");
    expect(typeof handle.cleanup).toBe("function");
  });

  it("cleanup runs `git worktree remove` then `git branch -D`", async () => {
    const { exec, calls } = makeExec([
      { stdout: "" }, // worktree add
      { stdout: "" }, // worktree remove
      { stdout: "" }, // branch -D
    ]);
    const handle = await createWorktree("/repo", {
      laneSlug: "wave_1",
      _deps: { execFile: exec },
    });
    await handle.cleanup();

    expect(calls.length).toBe(3);
    expect(calls[1].args.slice(0, 3)).toEqual(["worktree", "remove", handle.path]);
    expect(calls[2].args).toEqual(["branch", "-D", "autopilot/wave_1"]);
  });

  it("cleanup is idempotent (second call no-ops)", async () => {
    const { exec, calls } = makeExec([
      { stdout: "" }, // add
      { stdout: "" }, // remove
      { stdout: "" }, // branch -D
    ]);
    const handle = await createWorktree("/repo", {
      laneSlug: "wave_1",
      _deps: { execFile: exec },
    });
    await handle.cleanup();
    await handle.cleanup();
    // First call: add + remove + branch (3 calls). Second call: no extra invocations.
    expect(calls.length).toBe(3);
  });

  it("cleanup logs a warning and skips branch deletion when worktree remove fails", async () => {
    const warnings: Array<{ obj: unknown; msg?: string }> = [];
    const logger = {
      warn: (obj: unknown, msg?: string) => {
        warnings.push({ obj, msg });
      },
    };
    const { exec, calls } = makeExec([
      { stdout: "" }, // add succeeds
      { reject: { message: "worktree remove failed" } }, // remove fails
    ]);
    const handle = await createWorktree("/repo", {
      laneSlug: "wave_1",
      logger,
      _deps: { execFile: exec },
    });
    await handle.cleanup();

    // Only 2 calls — branch -D was skipped.
    expect(calls.length).toBe(2);
    expect(warnings.length).toBe(1);
    expect(warnings[0].msg).toContain("worktree cleanup failed");
  });

  it("cleanup logs a warning when branch deletion fails but does not throw", async () => {
    const warnings: Array<{ obj: unknown; msg?: string }> = [];
    const logger = {
      warn: (obj: unknown, msg?: string) => {
        warnings.push({ obj, msg });
      },
    };
    const { exec } = makeExec([
      { stdout: "" }, // add
      { stdout: "" }, // remove succeeds
      { reject: { message: "branch -D failed" } }, // branch -D fails
    ]);
    const handle = await createWorktree("/repo", {
      laneSlug: "wave_1",
      logger,
      _deps: { execFile: exec },
    });
    await handle.cleanup(); // must not throw
    expect(warnings.length).toBe(1);
    expect(warnings[0].msg).toContain("branch cleanup failed");
  });

  it("propagates `git worktree add` failure to the caller", async () => {
    const { exec } = makeExec([
      { reject: { message: "fatal: not a git repository" } },
    ]);
    await expect(
      createWorktree("/not-a-repo", {
        laneSlug: "wave_1",
        _deps: { execFile: exec },
      }),
    ).rejects.toThrow();
  });
});

describe("mergeWorktree", () => {
  it("invokes `git merge --no-ff <branch>` and returns ok on success", async () => {
    const { exec, calls } = makeExec([{ stdout: "Merge made by 'ort'" }]);
    const result = await mergeWorktree("/repo", {
      branch: "autopilot/wave_1",
      _deps: { execFile: exec },
    });
    expect(result.ok).toBe(true);
    expect(result.conflicts).toBeUndefined();
    expect(calls[0].args).toEqual(["merge", "--no-ff", "autopilot/wave_1"]);
    expect(calls[0].cwd).toBe("/repo");
  });

  it("on conflict returns ok=false with parsed conflict paths and aborts the merge", async () => {
    const conflictOutput =
      "Auto-merging src/foo.ts\n" +
      "CONFLICT (content): Merge conflict in src/foo.ts\n" +
      "Auto-merging src/bar.ts\n" +
      "CONFLICT (content): Merge conflict in src/bar.ts\n" +
      "Automatic merge failed; fix conflicts and then commit the result.\n";
    const { exec, calls } = makeExec([
      { reject: { stdout: conflictOutput, stderr: "" } },
      { stdout: "" }, // merge --abort
    ]);
    const result = await mergeWorktree("/repo", {
      branch: "autopilot/wave_2",
      _deps: { execFile: exec },
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(["src/foo.ts", "src/bar.ts"]);
    // Second call must be the abort.
    expect(calls.length).toBe(2);
    expect(calls[1].args).toEqual(["merge", "--abort"]);
  });

  it("swallows abort failure (no merge in progress)", async () => {
    const { exec } = makeExec([
      { reject: { stdout: "CONFLICT (content): Merge conflict in src/x.ts\n" } },
      { reject: { message: "fatal: There is no merge to abort" } },
    ]);
    const result = await mergeWorktree("/repo", {
      branch: "autopilot/x",
      _deps: { execFile: exec },
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(["src/x.ts"]);
  });

  it("returns empty conflict list when failure output has no CONFLICT lines", async () => {
    const { exec } = makeExec([
      { reject: { stdout: "fatal: refusing to merge unrelated histories" } },
      { stdout: "" }, // merge --abort
    ]);
    const result = await mergeWorktree("/repo", {
      branch: "autopilot/x",
      _deps: { execFile: exec },
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual([]);
  });
});
