/**
 * Repo-level setup hook for cwd-mode pilot runs.
 *
 * Checks for an executable file at `.glrs/hooks/pilot_setup` under the
 * current worktree. If present, runs it once at the top of `pilot build`
 * (or `pilot build-resume`) BEFORE the task loop starts. The hook's job
 * is to make the dev stack ready: `pnpm install`, `docker compose up`,
 * migrate, seed, whatever the user's plan expects to already be running.
 *
 * Contract:
 *   - Missing file → skip silently.
 *   - Present but not executable → abort with a clear error.
 *   - Non-zero exit → abort the pilot run (user fixes their env first).
 *   - 10-minute timeout → abort with a timeout-specific error.
 *   - stdout/stderr stream LIVE to the user's terminal so install
 *     progress is visible.
 *
 * Why a file instead of a `setup:` plan field:
 *   - It's version-controlled in the user's repo, not LLM-authored.
 *   - One hook per repo covers every plan — no cross-plan drift.
 *   - The user controls exactly what runs (no pilot-opinionated defaults).
 *
 * Environment:
 *   - Inherits `process.env` verbatim. Users who want pilot-specific
 *     behavior can gate on the presence of their own env vars.
 *   - Runs with `cwd = repo root` (the cwd pilot is operating in).
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const SETUP_HOOK_RELATIVE_PATH = ".glrs/hooks/pilot_setup";
export const SETUP_HOOK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type SetupHookResult =
  | { kind: "skipped" }
  | { kind: "ok"; durationMs: number }
  | { kind: "not-executable"; hookPath: string }
  | { kind: "failed"; hookPath: string; exitCode: number; durationMs: number }
  | { kind: "timed-out"; hookPath: string; timeoutMs: number }
  | { kind: "spawn-error"; hookPath: string; error: string };

/**
 * Run `.glrs/hooks/pilot_setup` if present. Returns a discriminated
 * result the caller logs + branches on.
 *
 * `onLine` is an optional callback for each line of stdout/stderr.
 * Defaults to writing directly to the current process's stderr so the
 * user sees install progress in real time. Tests pass a capturing stub.
 */
export async function runSetupHook(args: {
  cwd: string;
  /** Stream target for stdout + stderr lines. Defaults to process.stderr. */
  onLine?: (chunk: string) => void;
  /** Timeout override (ms). Defaults to SETUP_HOOK_TIMEOUT_MS. */
  timeoutMs?: number;
}): Promise<SetupHookResult> {
  const hookPath = path.join(args.cwd, SETUP_HOOK_RELATIVE_PATH);
  const onLine =
    args.onLine ?? ((chunk: string) => void process.stderr.write(chunk));
  const timeoutMs = args.timeoutMs ?? SETUP_HOOK_TIMEOUT_MS;

  // (1) Existence check. Missing = skip silently.
  let stat;
  try {
    stat = await fs.stat(hookPath);
  } catch {
    return { kind: "skipped" };
  }

  // (2) Executable bit. Refuse to shell-invoke a non-executable file
  //     so users don't silently hit "no-op" when they forgot chmod +x.
  //     The mode check is POSIX-only (Windows has no x-bit); on
  //     Windows we fall through to the spawn attempt, which will fail
  //     its own way and route through `spawn-error` below.
  if (process.platform !== "win32") {
    const mode = stat.mode;
    // eslint-disable-next-line no-bitwise
    const executable = (mode & 0o111) !== 0;
    if (!executable) {
      return { kind: "not-executable", hookPath };
    }
  }

  // (3) Run it. Inherit parent env verbatim.
  const start = Date.now();
  return await new Promise<SetupHookResult>((resolve) => {
    const child = spawn(hookPath, [], {
      cwd: args.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // best-effort
      }
      // Escalate to SIGKILL after a short grace period if the child
      // ignores SIGTERM. Short on purpose — a hook that ignores
      // SIGTERM is misbehaving, and we've already given it its full
      // timeout budget.
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // best-effort
        }
      }, 500);
    }, timeoutMs);

    child.stdout?.on("data", (buf: Buffer) => onLine(buf.toString()));
    child.stderr?.on("data", (buf: Buffer) => onLine(buf.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        kind: "spawn-error",
        hookPath,
        error: err.message,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (timedOut) {
        resolve({ kind: "timed-out", hookPath, timeoutMs });
        return;
      }
      if (signal !== null && signal !== undefined) {
        // Killed by a signal other than our own timeout (user ctrl-c'd
        // a parent process, SIGKILL from OOM, etc.). Treat as failure.
        resolve({
          kind: "failed",
          hookPath,
          exitCode: -1,
          durationMs,
        });
        return;
      }
      if (code !== 0) {
        resolve({
          kind: "failed",
          hookPath,
          exitCode: code ?? -1,
          durationMs,
        });
        return;
      }
      resolve({ kind: "ok", durationMs });
    });
  });
}
