/**
 * Shell-spawn primitives — the low-level command runner that backs
 * both the legacy `runVerify` (in ./runner.ts) and the gates module
 * (../gates/shell.ts).
 *
 * Extracted from runner.ts to break the import cycle that arose when
 * runner.ts started delegating to the gates layer:
 *   runner.ts → gates/eval.ts → gates/shell.ts → spawn.ts (was: runner.ts)
 *
 * The public types (RunVerifyOptions, CommandResult, etc.) live here
 * and are re-exported from runner.ts for backward compatibility.
 *
 * Why `bash -c` and not argv-style:
 *   - Verify commands routinely use shell features (pipes, redirection,
 *     `&&`-chaining, env-var interpolation). Forcing argv would require
 *     plan authors to wrap everything in a script file or inline `bash
 *     -c` themselves.
 *   - The schema layer validates each entry as a non-empty string;
 *     treating it as a shell command is the natural interpretation.
 *
 * Risk: a malicious `pilot.yaml` can shell-inject. That risk is
 * inherent — pilot plans run as arbitrary instructions to a
 * code-editing agent; the verify field is no more dangerous than
 * the prompt itself. We don't try to sandbox at this layer.
 *
 * Output handling:
 *   - stdout and stderr are interleaved into a single `output` string,
 *     ordered by arrival.
 *   - Output is buffered in memory AND streamed line-by-line to an
 *     optional `onLine` callback.
 *   - Output is truncated to a configurable byte cap (default 256KB)
 *     to prevent a runaway test from blowing memory. Truncation is
 *     marked with a sentinel line.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

// --- Constants -------------------------------------------------------------

/**
 * Default per-command timeout. 5 minutes is generous enough for most
 * test suites, not so long that a hung process burns the worker's
 * wall time.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Default output cap. 256 KB captures a typical test-failure dump
 * without hoarding memory across many failed verify attempts.
 */
const DEFAULT_OUTPUT_CAP_BYTES = 256 * 1024;

const TRUNCATION_NOTICE = "\n[pilot] verify output truncated\n";

// --- Public types ----------------------------------------------------------

export type RunVerifyOptions = {
  /** Working directory for the commands (the task's worktree path). */
  cwd: string;

  /**
   * Per-command timeout. Default 5min. The runner kills the process
   * tree when this expires (SIGTERM, then SIGKILL after 2s grace).
   */
  timeoutMs?: number;

  /**
   * Maximum captured output per command. Default 256KB. Excess is
   * dropped with a truncation notice appended to the buffer.
   */
  outputCapBytes?: number;

  /**
   * Optional line streaming callback. Called once per output line
   * (split on `\n`) for both stdout and stderr.
   */
  onLine?: (args: {
    stream: "stdout" | "stderr";
    line: string;
    command: string;
  }) => void;

  /**
   * Optional abort signal — when aborted, the in-flight command is
   * killed and the runner returns a fail result.
   */
  abortSignal?: AbortSignal;

  /**
   * Optional environment overrides. Defaults to inheriting
   * process.env. Use to set CI-specific vars, test secrets, etc.
   */
  env?: NodeJS.ProcessEnv;
};

export type CommandFailure = {
  ok: false;
  command: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  /** True if the failure was caused by a timeout (signal forced). */
  timedOut: boolean;
  /** True if aborted via `abortSignal`. */
  aborted: boolean;
  /** Captured output (may be truncated). */
  output: string;
  /** Time the command ran, in milliseconds. */
  durationMs: number;
};

export type CommandSuccess = {
  ok: true;
  command: string;
  exitCode: 0;
  output: string;
  durationMs: number;
};

export type CommandResult = CommandSuccess | CommandFailure;

// --- Public API ------------------------------------------------------------

/**
 * Run a single shell command via `bash -c`. Returns a CommandResult
 * preserving exit code, signal, output, and timing.
 *
 * This is the only spawn primitive in the pilot codebase. The gates
 * module's shell evaluator calls it; the legacy runVerify (in
 * ./runner.ts) calls it via the gates layer.
 */
export async function runOne(
  command: string,
  options: RunVerifyOptions,
): Promise<CommandResult> {
  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError(`runOne: command must be a non-empty string`);
  }
  if (typeof options.cwd !== "string" || options.cwd.length === 0) {
    throw new TypeError(`runOne: options.cwd is required and must be non-empty`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputCap = options.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;

  const startedAt = Date.now();
  const buffer: string[] = [];
  let bufferBytes = 0;
  let truncated = false;

  // Per-stream line splitters. Output arrives in chunks that may not
  // align with line boundaries; we buffer the trailing partial line
  // and flush it on close.
  const streamState: Record<"stdout" | "stderr", { partial: string }> = {
    stdout: { partial: "" },
    stderr: { partial: "" },
  };

  const child: ChildProcess = spawn("bash", ["-c", command], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let timedOut = false;
  let aborted = false;

  // Timeout handling — SIGTERM then SIGKILL.
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, timeoutMs);

  // Abort handling.
  const onAbort = (): void => {
    aborted = true;
    killTree(child);
  };
  if (options.abortSignal) {
    if (options.abortSignal.aborted) {
      onAbort();
    } else {
      options.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const handleChunk = (
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (!truncated) {
      const remaining = outputCap - bufferBytes;
      if (remaining <= 0) {
        truncated = true;
        buffer.push(TRUNCATION_NOTICE);
      } else if (text.length > remaining) {
        buffer.push(text.slice(0, remaining));
        bufferBytes = outputCap;
        truncated = true;
        buffer.push(TRUNCATION_NOTICE);
      } else {
        buffer.push(text);
        bufferBytes += text.length;
      }
    }

    if (options.onLine) {
      const state = streamState[stream];
      const combined = state.partial + text;
      const lines = combined.split("\n");
      state.partial = lines.pop()!; // keep trailing partial
      for (const line of lines) {
        options.onLine({ stream, line, command });
      }
    }
  };

  child.stdout?.on("data", (c) => handleChunk("stdout", c));
  child.stderr?.on("data", (c) => handleChunk("stderr", c));

  // Wait for exit.
  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    let resolved = false;
    const finalize = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (resolved) return;
      resolved = true;
      resolve({ code, signal });
    };
    child.on("error", (err) => {
      // Spawn-time errors (e.g. ENOENT for bash itself) — surface as
      // exit -1 with the message as output.
      if (!truncated) {
        buffer.push(`\n[pilot] runner spawn error: ${err.message}\n`);
      }
      finalize(-1, null);
    });
    child.on("exit", (c, s) => finalize(c, s));
  });

  clearTimeout(timeoutHandle);
  if (options.abortSignal) {
    options.abortSignal.removeEventListener("abort", onAbort);
  }

  // Flush any trailing partial lines.
  if (options.onLine) {
    for (const stream of ["stdout", "stderr"] as const) {
      const partial = streamState[stream].partial;
      if (partial.length > 0) {
        options.onLine({ stream, line: partial, command });
      }
    }
  }

  const output = buffer.join("");
  const durationMs = Date.now() - startedAt;

  if (code === 0 && !timedOut && !aborted) {
    return {
      ok: true,
      command,
      exitCode: 0,
      output,
      durationMs,
    };
  }
  return {
    ok: false,
    command,
    exitCode: code ?? -1,
    signal,
    timedOut,
    aborted,
    output,
    durationMs,
  };
}

// --- Internals -------------------------------------------------------------

/**
 * Kill the child and any descendants. Send SIGTERM first; if the
 * process is still alive after 2s, send SIGKILL. The 2s grace lets
 * test frameworks finish writing failure output.
 *
 * NB: the child was spawned with `bash -c <command>`, so the bash
 * process is the parent of any test runner, server, etc. We send the
 * signal to bash; on Linux/macOS, bash forwards SIGTERM to its job
 * group, which propagates to descendants.
 */
function killTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // Already dead.
    return;
  }
  setTimeout(() => {
    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // best effort
      }
    }
  }, 2_000).unref();
}
