/**
 * Pilot v2 safety gate.
 *
 * Pre-flight checks before any pilot command modifies the working tree:
 * 1. Must be inside a git repo.
 * 2. Must NOT be on main/master/default branch.
 * 3. Working tree must be clean (no uncommitted changes).
 *
 * These are the same invariants as the old pilot v1 safety-gate.ts,
 * reimplemented cleanly without the old module's baggage.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type SafetyCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

// Branches that are never safe to run pilot on.
const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

/**
 * Run all pre-flight safety checks for the given working directory.
 * Returns { ok: true } if all pass, or { ok: false, reason } on first failure.
 */
export async function checkSafety(cwd: string): Promise<SafetyCheckResult> {
  // 1. Inside a git repo?
  try {
    await execFileP("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  } catch {
    return { ok: false, reason: "Not inside a git repository." };
  }

  // 2. Not on a protected branch?
  let branch: string;
  try {
    const { stdout } = await execFileP("git", ["branch", "--show-current"], { cwd });
    branch = stdout.trim();
  } catch {
    return { ok: false, reason: "Could not determine current branch." };
  }

  if (PROTECTED_BRANCHES.has(branch)) {
    return {
      ok: false,
      reason: `Refusing to run pilot on protected branch "${branch}". ` +
        `Create a feature branch first (e.g. git checkout -b feat/my-feature).`,
    };
  }

  // 3. Clean working tree?
  let status: string;
  try {
    const { stdout } = await execFileP("git", ["status", "--porcelain"], { cwd });
    status = stdout.trim();
  } catch {
    return { ok: false, reason: "Could not check working tree status." };
  }

  if (status.length > 0) {
    const lines = status.split("\n").slice(0, 5);
    const preview = lines.join("\n  ");
    return {
      ok: false,
      reason: `Working tree is dirty. Commit or stash changes before running pilot.\n  ${preview}`,
    };
  }

  return { ok: true };
}

/**
 * Get the current HEAD SHA. Returns null if not in a git repo or no commits.
 */
export async function headSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
