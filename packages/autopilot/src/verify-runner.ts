/**
 * Verify-command runner for the post-phase test gate (item 4.1).
 *
 * After a phase reports `phaseComplete === true` (every checkbox checked),
 * the orchestrator runs each plan-state item's `verify:` command in a
 * child process and reports pass/fail. Phases whose verify commands
 * fail are treated as incomplete — the failure is fed back into the
 * next iteration's prompt so the agent can fix it.
 *
 * Each command runs via `/bin/sh -c` so users can write shell features
 * (pipes, redirects, env vars) into a `verify:` field. Per-command
 * timeout is determined by the item's proof_type:
 * - unit_test: 30s, api_check: 10s, structural/typecheck: 60s, e2e: 120s
 * - unknown/custom: uses config.verify_timeout (default 5 minutes).
 * On timeout we synthesize a stderr message and return `passed: false`
 * rather than throwing — `runVerifyCommands` always returns a
 * `VerifyResult[]` so callers can build a result table without wrapping
 * every call in try/catch.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { PlanItem } from "./plan-parser.js";

const execFileDefault = promisify(execFileCb);

/** Result of running a single `verify:` command. */
export interface VerifyResult {
  /** Plan-state item id (e.g. "4.1"). */
  itemId: string;
  /** The exact command string that was run. */
  command: string;
  /** True iff the child process exited with code 0 within the timeout. */
  passed: boolean;
  stdout: string;
  stderr: string;
  /** Wall-clock duration of the command in milliseconds. */
  durationMs: number;
}

export interface RunVerifyCommandsOptions {
  /** Per-command timeout in milliseconds (default: 5 minutes). */
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
 * Verify strategy configuration (read from config.verify).
 * - `after_phase`: run verify after the entire phase completes (default).
 * - `after_item`: run verify after each item in fast mode (deep mode falls back to after_phase).
 * - `skip`: bypass verify entirely, mark phase complete regardless.
 */
export type VerifyStrategy = "after_phase" | "after_item" | "skip";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Get the timeout (in ms) for a verify command based on its proof type.
 * Different proof types need different timeouts:
 * - unit_test: 30s
 * - api_check: 10s
 * - structural, typecheck: 60s
 * - e2e: 120s
 * - unknown/custom: uses customTimeoutMs
 */
function getTimeoutForProofType(
  proofType: string | undefined,
  customTimeoutMs: number,
): number {
  if (!proofType) return customTimeoutMs;

  switch (proofType) {
    case "unit_test":
      return 30 * 1000;
    case "api_check":
      return 10 * 1000;
    case "structural":
    case "typecheck":
      return 60 * 1000;
    case "e2e":
      return 120 * 1000;
    default:
      return customTimeoutMs;
  }
}

/**
 * Run each item's `verify:` command in `cwd` and return the results.
 *
 * Items without a `verify:` field are skipped (no result emitted). The
 * function never throws — every executed command yields exactly one
 * `VerifyResult`, including timeouts and spawn failures.
 */
export async function runVerifyCommands(
  items: PlanItem[],
  cwd: string,
  opts: RunVerifyCommandsOptions = {},
): Promise<VerifyResult[]> {
  const execFile = opts._deps?.execFile ?? execFileDefault;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results: VerifyResult[] = [];

  for (const item of items) {
    const command = item.verify?.trim();
    if (!command) continue;

    const itemTimeoutMs = getTimeoutForProofType(item.proof_type, timeoutMs);
    const start = Date.now();
    try {
      const { stdout, stderr } = await execFile("/bin/sh", ["-c", command], {
        cwd,
        signal: AbortSignal.timeout(itemTimeoutMs),
        // Capture as much output as the command produces — verify
        // commands are typically test runs; truncating their output
        // would hide the failure detail we want in the next prompt.
        maxBuffer: 10 * 1024 * 1024,
      });
      results.push({
        itemId: item.id,
        command,
        passed: true,
        stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
        stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
        durationMs: Date.now() - start,
      });
    } catch (err) {
      // execFile rejects on:
      //   - non-zero exit (err.code === <number>)
      //   - signal kill (err.signal === "SIGTERM" etc.)
      //   - AbortSignal trip (err.name === "AbortError")
      //   - spawn failure (ENOENT, EACCES, etc.)
      // In every case we want a `passed: false` result with whatever
      // output we captured, NOT a thrown exception bubbling up.
      const e = err as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      const isTimeout = e.name === "AbortError" || e.code === "ABORT_ERR";
      const stdout =
        e.stdout !== undefined
          ? typeof e.stdout === "string"
            ? e.stdout
            : e.stdout.toString()
          : "";
      let stderr =
        e.stderr !== undefined
          ? typeof e.stderr === "string"
            ? e.stderr
            : e.stderr.toString()
          : "";
      if (isTimeout) {
        stderr =
          (stderr ? stderr + "\n" : "") +
          `[verify-runner] command timed out after ${Math.round(itemTimeoutMs / 1000)}s`;
      } else if (!stderr && e.message) {
        stderr = e.message;
      }
      results.push({
        itemId: item.id,
        command,
        passed: false,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

/**
 * Format a VerifyResult[] as a markdown-ready summary table, useful for
 * the debrief and for feeding failures back into the next iteration's
 * prompt. Returns an empty string when there are no results.
 */
export function formatVerifyResultsTable(results: VerifyResult[]): string {
  if (results.length === 0) return "";
  const lines: string[] = [];
  lines.push("| Item | Command | Result | Duration |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of results) {
    const cmd =
      r.command.length > 60 ? r.command.slice(0, 57) + "..." : r.command;
    const status = r.passed ? "✓ pass" : "✗ fail";
    const dur =
      r.durationMs < 1000
        ? `${r.durationMs}ms`
        : `${(r.durationMs / 1000).toFixed(1)}s`;
    lines.push(`| ${r.itemId} | \`${cmd}\` | ${status} | ${dur} |`);
  }
  return lines.join("\n");
}
