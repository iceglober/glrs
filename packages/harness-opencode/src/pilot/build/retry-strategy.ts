/**
 * retry-strategy.ts — tree-state management between retry attempts.
 *
 * Two modes:
 *   reset — discard working tree changes (git reset --hard HEAD && git clean -fd)
 *           This is the current behavior and the default.
 *   keep  — preserve partial work on a scratch branch for the next attempt
 *           to build on. Branch name: pilot-attempt/<runId>/<taskId>
 *
 * NOTE: "keep" mode is a stub. It logs a warning and falls back to reset.
 * Full implementation requires session teardown/recreation which is a
 * separate concern.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- Types ------------------------------------------------------------------

/**
 * Retry strategy mode from the plan defaults.
 *
 *   reset — discard working tree changes between attempts (current behavior)
 *   keep  — preserve partial work on a scratch branch (stub)
 */
export type RetryStrategyMode = "reset" | "keep";

/**
 * Options for applying a retry strategy.
 */
export interface RetryStrategyOptions {
  /** The working directory (cwd). */
  cwd: string;
  /** The retry strategy mode. */
  mode: RetryStrategyMode;
  /** Run ID (used for keep-mode branch naming). */
  runId: string;
  /** Task ID (used for keep-mode branch naming). */
  taskId: string;
  /** Timeout for git operations in ms. Default: 30_000. */
  timeoutMs?: number;
}

/**
 * Result of applying a retry strategy.
 */
export type RetryStrategyResult =
  | { ok: true; mode: RetryStrategyMode; branch?: string }
  | { ok: false; mode: RetryStrategyMode; error: string };

// --- Strategy functions -----------------------------------------------------

/**
 * Apply the retry strategy between attempts.
 *
 * For "reset": runs `git reset --hard HEAD && git clean -fd` to discard
 * all working tree changes. This is the current worker behavior.
 *
 * For "keep": logs a warning and falls back to reset. Full implementation
 * is a separate concern (requires session teardown/recreation).
 *
 * @param opts  Options including cwd, mode, runId, taskId.
 * @returns     Whether the strategy was applied successfully.
 */
export async function applyRetryStrategy(
  opts: RetryStrategyOptions,
): Promise<RetryStrategyResult> {
  const { cwd, mode, runId, taskId, timeoutMs = 30_000 } = opts;

  if (mode === "keep") {
    // STUB: keep mode is not yet implemented.
    // Log a warning and fall back to reset.
    console.warn(
      `[pilot] retry-strategy: 'keep' mode is not yet implemented ` +
        `(run=${runId}, task=${taskId}). Falling back to 'reset'.`,
    );
    return applyReset(cwd, timeoutMs);
  }

  return applyReset(cwd, timeoutMs);
}

/**
 * Apply the reset strategy: discard all working tree changes.
 * Equivalent to `git reset --hard HEAD && git clean -fd`.
 */
async function applyReset(
  cwd: string,
  timeoutMs: number,
): Promise<RetryStrategyResult> {
  try {
    await execFileAsync("git", ["reset", "--hard", "HEAD"], {
      cwd,
      timeout: timeoutMs,
    });
    await execFileAsync("git", ["clean", "-fd"], {
      cwd,
      timeout: timeoutMs,
    });
    return { ok: true, mode: "reset" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, mode: "reset", error };
  }
}

/**
 * Compute the scratch branch name for keep mode.
 * Pattern: pilot-attempt/<runId>/<taskId>
 */
export function keepModeBranchName(runId: string, taskId: string): string {
  return `pilot-attempt/${runId}/${taskId}`;
}
