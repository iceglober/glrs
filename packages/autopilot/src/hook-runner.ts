/**
 * Lifecycle hook runner for autopilot phases and runs (item 3.3).
 *
 * Runs user-supplied shell commands at four points: pre_phase (before each phase),
 * post_phase (after a phase completes), post_run (after all phases), and on_error
 * (when a phase fails). Each hook runs via `/bin/sh -c` with a configurable timeout.
 * Never throws — all failures return a structured { ok, output } result.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCb);

/**
 * Options for running a hook.
 */
export interface RunHookOptions {
  /**
   * Per-hook timeout in milliseconds. Non-zero exit, timeout, or spawn error
   * returns { ok: false, output }.
   */
  timeoutMs?: number;
  /**
   * Test-only: inject execFile replacement.
   * @internal
   */
  _deps?: {
    execFile?: typeof execFileDefault;
  };
}

/**
 * Run a shell hook command. Never throws.
 *
 * @param cmd The shell command to run (e.g., "npm run build"). Empty/whitespace
 *            returns { ok: true, output: "" } without spawning.
 * @param cwd Working directory for the command.
 * @param timeoutMs Timeout in milliseconds for command execution.
 * @param opts Optional dependencies and configuration.
 * @returns { ok: true, output: "" } on success (exit 0) or no-op;
 *          { ok: false, output: <error message> } on failure.
 */
export async function runHook(
  cmd: string | undefined,
  cwd: string,
  timeoutMs: number,
  opts: RunHookOptions = {},
): Promise<{ ok: boolean; output: string }> {
  // Whitespace-only or undefined cmd is a no-op
  if (!cmd?.trim()) {
    return { ok: true, output: "" };
  }

  const execFile = opts._deps?.execFile ?? execFileDefault;
  const timeout = opts.timeoutMs ?? timeoutMs;

  try {
    const { stdout, stderr } = await execFile("/bin/sh", ["-c", cmd], {
      cwd,
      signal: AbortSignal.timeout(timeout),
      maxBuffer: 10 * 1024 * 1024,
    });
    const combinedOutput =
      (typeof stdout === "string" ? stdout : String(stdout ?? "")) +
      (typeof stderr === "string" ? stderr : String(stderr ?? ""));
    return { ok: true, output: combinedOutput };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const isTimeout = e.name === "AbortError" || e.code === "ABORT_ERR";
    let stderr =
      e.stderr !== undefined
        ? typeof e.stderr === "string"
          ? e.stderr
          : e.stderr.toString()
        : "";
    if (isTimeout) {
      stderr =
        (stderr ? stderr + "\n" : "") +
        `[hook-runner] command timed out after ${Math.round(timeout / 1000)}s`;
    } else if (!stderr && e.message) {
      stderr = e.message;
    }
    return { ok: false, output: stderr };
  }
}
