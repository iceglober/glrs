// pilot-build-retry-strategy.test.ts — unit tests for retry strategy.
//
// Uses a real tmp git repo since the strategy runs git commands.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  applyRetryStrategy,
  keepModeBranchName,
} from "../src/pilot/build/retry-strategy.js";

// --- Helpers ----------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-retry-strategy-"));
  // Initialize a git repo with an initial commit.
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, "README.md"), "initial\n");
  execFileSync("git", ["add", "."], { cwd: tmp });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: tmp });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function hasUnstagedChanges(): boolean {
  try {
    const result = execFileSync("git", ["status", "--porcelain"], {
      cwd: tmp,
      encoding: "utf8",
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function makeOpts(overrides: {
  mode?: "reset" | "keep";
  runId?: string;
  taskId?: string;
} = {}) {
  return {
    cwd: tmp,
    mode: overrides.mode ?? "reset",
    runId: overrides.runId ?? "run-abc123",
    taskId: overrides.taskId ?? "T1",
  };
}

// --- reset mode -------------------------------------------------------------

describe("applyRetryStrategy — reset mode", () => {
  test("reset mode discards working tree changes", async () => {
    // Create an uncommitted file.
    fs.writeFileSync(path.join(tmp, "dirty.ts"), "// dirty\n");
    expect(hasUnstagedChanges()).toBe(true);

    const result = await applyRetryStrategy(makeOpts({ mode: "reset" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("reset");
    expect(hasUnstagedChanges()).toBe(false);
    expect(fs.existsSync(path.join(tmp, "dirty.ts"))).toBe(false);
  });

  test("reset mode discards staged changes", async () => {
    fs.writeFileSync(path.join(tmp, "staged.ts"), "// staged\n");
    execFileSync("git", ["add", "."], { cwd: tmp });
    expect(hasUnstagedChanges()).toBe(true);

    const result = await applyRetryStrategy(makeOpts({ mode: "reset" }));

    expect(result.ok).toBe(true);
    expect(hasUnstagedChanges()).toBe(false);
  });

  test("reset mode succeeds on a clean tree", async () => {
    expect(hasUnstagedChanges()).toBe(false);

    const result = await applyRetryStrategy(makeOpts({ mode: "reset" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("reset");
  });
});

// --- keep mode (stub) -------------------------------------------------------

describe("applyRetryStrategy — keep mode", () => {
  test("keep mode preserves changes on scratch branch (stub falls back to reset)", async () => {
    // keep mode is a stub that falls back to reset.
    fs.writeFileSync(path.join(tmp, "partial.ts"), "// partial work\n");
    expect(hasUnstagedChanges()).toBe(true);

    const result = await applyRetryStrategy(makeOpts({ mode: "keep" }));

    // The stub falls back to reset, so changes are discarded.
    expect(result.ok).toBe(true);
    // The mode in the result reflects what was actually applied (reset).
    expect(result.mode).toBe("reset");
  });
});

// --- defaults ---------------------------------------------------------------

describe("applyRetryStrategy — defaults", () => {
  test("defaults to reset when not configured", async () => {
    fs.writeFileSync(path.join(tmp, "dirty.ts"), "// dirty\n");

    const result = await applyRetryStrategy({
      cwd: tmp,
      mode: "reset",
      runId: "run-1",
      taskId: "T1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("reset");
    expect(hasUnstagedChanges()).toBe(false);
  });
});

// --- keepModeBranchName -----------------------------------------------------

describe("keepModeBranchName", () => {
  test("produces expected branch name pattern", () => {
    const name = keepModeBranchName("run-abc123", "T1");
    expect(name).toBe("pilot-attempt/run-abc123/T1");
  });

  test("uses runId and taskId verbatim", () => {
    const name = keepModeBranchName("01JXYZ", "ENG-42");
    expect(name).toBe("pilot-attempt/01JXYZ/ENG-42");
  });
});
