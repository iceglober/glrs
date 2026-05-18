/**
 * Git worktree helpers for parallel-lane execution (item 3.2).
 *
 * Each parallel lane runs against its own worktree branched from the
 * current HEAD. On phase completion, the worktree's branch is merged
 * back into the main repo with `--no-ff` to preserve per-phase commits.
 *
 * All git invocations follow the same `execFile + try/catch` shape used
 * by `loop.ts` (lines 126-146 — see file-level comment in that module).
 *
 * Cleanup is best-effort: failures log warnings via the injected logger
 * but never throw. Orphaned worktrees on disk surface in the debrief
 * (item 3.6 wiring) so the user can manually `git worktree remove --force`.
 *
 * Pure runtime — no test pollution. Tests inject `_deps.execFile` to mock
 * git invocations.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileDefault = promisify(execFileCb);

/**
 * Minimal logger surface — accepts any subset of pino-like methods so
 * tests can pass a no-op or a recording array. The real call sites pass
 * pino childLoggers.
 */
export interface WorktreeLogger {
  warn?: (objOrMsg: unknown, msg?: string) => void;
  info?: (objOrMsg: unknown, msg?: string) => void;
  debug?: (objOrMsg: unknown, msg?: string) => void;
}

export interface WorktreeHandle {
  /** Filesystem path of the new worktree. */
  path: string;
  /** Branch name created for this worktree. */
  branch: string;
  /**
   * Best-effort cleanup: `git worktree remove` then `git branch -D`.
   * Failures are logged via the logger passed to createWorktree and never
   * thrown. Safe to call multiple times (subsequent calls no-op).
   */
  cleanup: () => Promise<void>;
}

export interface CreateWorktreeOptions {
  /** Slug for the lane — used in branch and path naming. */
  laneSlug: string;
  /** Optional logger for cleanup-warning emission. */
  logger?: WorktreeLogger;
  /** Test-only: inject execFile replacement. */
  _deps?: {
    execFile?: typeof execFileDefault;
  };
}

export interface MergeWorktreeOptions {
  /** Branch name to merge back into the current HEAD of repoRoot. */
  branch: string;
  /** Test-only: inject execFile replacement. */
  _deps?: {
    execFile?: typeof execFileDefault;
  };
}

export interface MergeResult {
  ok: boolean;
  /** Files reported as conflicting by `git merge`, when ok=false. */
  conflicts?: string[];
}

/**
 * Create a new git worktree branched from the current HEAD of `repoRoot`.
 *
 * Path: `<repoRoot>/.agent/worktrees/<laneSlug>-<epoch>`
 * Branch: `autopilot/<laneSlug>`
 *
 * The `.agent/worktrees/` parent matches the existing `.agent/` convention
 * for kill-switch and status state — keeps lane artefacts grouped with
 * other autopilot runtime files.
 *
 * Throws on failure (the caller decides whether to fall back to sequential).
 * Cleanup-via-handle is best-effort and logs only.
 */
export async function createWorktree(
  repoRoot: string,
  opts: CreateWorktreeOptions,
): Promise<WorktreeHandle> {
  const exec = opts._deps?.execFile ?? execFileDefault;
  const logger = opts.logger;

  const stamp = Date.now();
  const wtPath = path.join(repoRoot, ".agent", "worktrees", `${opts.laneSlug}-${stamp}`);
  const branch = `autopilot/${opts.laneSlug}`;

  // `git worktree add <path> -b <branch>` — branches from current HEAD.
  await exec("git", ["worktree", "add", wtPath, "-b", branch], { cwd: repoRoot });

  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await exec("git", ["worktree", "remove", wtPath], { cwd: repoRoot });
    } catch (err) {
      logger?.warn?.(
        { err: err instanceof Error ? err.message : String(err), path: wtPath },
        `worktree cleanup failed for ${wtPath}`,
      );
      // Don't try to delete the branch if the worktree removal failed —
      // that branch may still be checked out somewhere.
      return;
    }
    try {
      await exec("git", ["branch", "-D", branch], { cwd: repoRoot });
    } catch (err) {
      logger?.warn?.(
        { err: err instanceof Error ? err.message : String(err), branch },
        `branch cleanup failed for ${branch}`,
      );
    }
  };

  return { path: wtPath, branch, cleanup };
}

/**
 * Parse `git merge` failure output to extract the list of conflicting
 * file paths. The output format from a conflicted merge looks like:
 *
 *   CONFLICT (content): Merge conflict in src/foo.ts
 *   CONFLICT (add/add): Merge conflict in src/bar.ts
 *
 * Returns the deduplicated list of paths.
 */
function parseConflictPaths(output: string): string[] {
  const paths = new Set<string>();
  const re = /^CONFLICT\s*\([^)]*\):\s*Merge conflict in\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    paths.add(m[1].trim());
  }
  return [...paths];
}

/**
 * Merge a worktree's branch back into the current HEAD of repoRoot.
 * Uses `git merge --no-ff` so each phase keeps an explicit merge commit
 * in history, making it trivial to bisect across parallel lanes.
 *
 * Returns `{ ok: true }` on success. On merge conflict, returns
 * `{ ok: false, conflicts: [...] }` and aborts the merge so the
 * working tree is restored — the caller falls back to sequential
 * execution for that phase per item 3.2's conventions.
 */
export async function mergeWorktree(
  repoRoot: string,
  opts: MergeWorktreeOptions,
): Promise<MergeResult> {
  const exec = opts._deps?.execFile ?? execFileDefault;

  try {
    await exec("git", ["merge", "--no-ff", opts.branch], { cwd: repoRoot });
    return { ok: true };
  } catch (err) {
    // execFile rejects with an Error that has stdout/stderr properties.
    const e = err as { stdout?: string; stderr?: string };
    const combined = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    const conflicts = parseConflictPaths(combined);

    // Best-effort: abort the conflicted merge so the working tree is clean.
    try {
      await exec("git", ["merge", "--abort"], { cwd: repoRoot });
    } catch {
      // If --abort fails (no merge in progress, etc.), ignore — the
      // caller's responsibility is to surface the conflict, not recover.
    }

    return { ok: false, conflicts };
  }
}
