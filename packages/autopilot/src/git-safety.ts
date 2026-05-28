/**
 * Phase-level git safety: record-and-soft-reset helpers.
 *
 * Used by the multi-phase loop runner (loop-session.ts) to capture
 * HEAD before each phase. If a phase fails (struggle / stall / error)
 * and the rollback_on_failure config allows it, `resetSoft` rolls
 * the worktree back to that SHA,
 * preserving any changes in the index so nothing is lost.
 *
 * Safety invariants (per AGENTS.md and Wave 2 plan):
 *   - NEVER use `git reset --hard`. Soft reset only.
 *   - Any git failure here is non-fatal — log and continue.
 *   - Helpers use `execFile` from node:child_process via promisify.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";

const execFile = promisify(execFileCb);

/**
 * Injectable execFile for testing.
 * @internal
 */
export interface GitSafetyDeps {
  /**
   * Mock the git invocation. Receives the args array; returns
   * { stdout, stderr } or throws to simulate a git failure.
   */
  execGit?: (
    args: string[],
    cwd: string,
  ) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Record the current HEAD SHA. Returns "HEAD" on any failure
 * (matches the existing getHeadSha shape in loop.ts so callers can
 * pass the result to git operations without crashing).
 */
export async function recordHead(
  cwd: string,
  deps?: GitSafetyDeps,
): Promise<string> {
  const exec = deps?.execGit ?? ((args: string[], c: string) => execFile("git", args, { cwd: c }));
  try {
    const { stdout } = await exec(["rev-parse", "HEAD"], cwd);
    return stdout.trim();
  } catch {
    return "HEAD";
  }
}

/**
 * Soft-reset the worktree to the given SHA. Changes since `sha` move
 * to the staging area; nothing is destroyed. Any failure is logged
 * via the optional `onWarn` callback and swallowed.
 *
 * Returns true on success, false on failure.
 */
export async function resetSoft(
  cwd: string,
  sha: string,
  opts?: GitSafetyDeps & { onWarn?: (msg: string) => void },
): Promise<boolean> {
  const exec =
    opts?.execGit ?? ((args: string[], c: string) => execFile("git", args, { cwd: c }));
  // Defensive: refuse to run if sha looks empty or "HEAD" (no-op).
  if (!sha || sha === "HEAD") {
    opts?.onWarn?.(`resetSoft: invalid sha "${sha}" — skipping`);
    return false;
  }
  try {
    await exec(["reset", "--soft", sha], cwd);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts?.onWarn?.(`resetSoft failed: ${msg}`);
    return false;
  }
}

/**
 * Commit uncommitted changes if the working tree is dirty. Smart-optional:
 * no uncommitted changes → no-op. Never throws.
 *
 * Used by the orchestrator after each item to ensure per-item commit
 * boundaries even when the agent forgets to commit.
 */
export async function commitIfDirty(
  cwd: string,
  message: string,
  opts?: GitSafetyDeps,
): Promise<{ committed: boolean; sha?: string }> {
  const exec =
    opts?.execGit ?? ((args: string[], c: string) => execFile("git", args, { cwd: c }));
  try {
    const { stdout } = await exec(["status", "--porcelain"], cwd);
    if (!stdout.trim()) return { committed: false };

    await exec(["add", "-A"], cwd);
    await exec(["commit", "-m", message], cwd);
    const { stdout: sha } = await exec(["rev-parse", "HEAD"], cwd);
    return { committed: true, sha: sha.trim() };
  } catch {
    return { committed: false };
  }
}

/**
 * Snapshot the spec directory so it can survive branch switches and
 * rollbacks. The agent can switch branches during execution (e.g.,
 * `git checkout -b feat/...`), which removes spec files from the
 * working tree. This captures them to a temp location.
 *
 * Returns a restore function that copies missing files back.
 */
export function snapshotSpecDir(planPath: string): () => void {
  const specDir = path.join(planPath, "spec");
  const snapshotDir = path.join(planPath, ".spec-snapshot");

  try {
    if (!fs.existsSync(specDir)) return () => {};

    if (fs.existsSync(snapshotDir)) {
      fs.rmSync(snapshotDir, { recursive: true });
    }
    fs.mkdirSync(snapshotDir, { recursive: true });

    for (const file of fs.readdirSync(specDir)) {
      fs.copyFileSync(
        path.join(specDir, file),
        path.join(snapshotDir, file),
      );
    }
  } catch {
    return () => {};
  }

  return () => {
    try {
      if (!fs.existsSync(snapshotDir)) return;
      if (!fs.existsSync(specDir)) {
        fs.mkdirSync(specDir, { recursive: true });
      }
      for (const file of fs.readdirSync(snapshotDir)) {
        const target = path.join(specDir, file);
        if (!fs.existsSync(target)) {
          fs.copyFileSync(path.join(snapshotDir, file), target);
        }
      }
    } catch { /* best-effort restore */ }
  };
}
