/**
 * Autopilot post-run debrief module.
 *
 * After the Ralph loop exits (any exit reason), runDebrief spawns a
 * @debriefer session, sends a structured context blob, waits for the
 * response, and prints the structured summary to stdout.
 *
 * On any failure, prints a warning and returns gracefully — the loop
 * result is the source of truth for exit code.
 */

import {
  createSession,
  sendAndWait,
  getLastAssistantMessage,
} from "../lib/opencode-server.js";
import type { StartedServer } from "../lib/opencode-server.js";
import type { LoopResult } from "./loop.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebriefOptions {
  /** The already-started OpenCode server (owned by the CLI). */
  server: StartedServer;
  /** The result from runRalphLoop. */
  loopResult: LoopResult & { sessionId?: string; cumulativeCostUsd?: number };
  /** The original prompt passed to the loop. */
  prompt: string;
  /** Working directory (used for git diff stat). */
  cwd: string;
  /**
   * Injectable dependencies for testing.
   * @internal
   */
  _deps?: {
    createSession?: typeof import("../lib/opencode-server.js").createSession;
    sendAndWait?: typeof import("../lib/opencode-server.js").sendAndWait;
    getLastAssistantMessage?: typeof import("../lib/opencode-server.js").getLastAssistantMessage;
    execGitDiffStat?: (cwd: string) => Promise<string>;
  };
}

export interface ShouldRunDebriefOptions {
  noDebrief: boolean;
  env: Record<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// shouldRunDebrief — pure logic, easily testable
// ---------------------------------------------------------------------------

/**
 * Returns true if the debrief should run given the CLI flag and env var.
 *
 * - `--no-debrief` flag → false
 * - `GLRS_AUTOPILOT_DEBRIEF=off` (case-insensitive) → false
 * - Otherwise → true
 */
export function shouldRunDebrief(opts: ShouldRunDebriefOptions): boolean {
  if (opts.noDebrief) return false;
  const envVal = opts.env["GLRS_AUTOPILOT_DEBRIEF"];
  if (envVal !== undefined && envVal.toLowerCase() === "off") return false;
  return true;
}

// ---------------------------------------------------------------------------
// execGitDiffStat — default implementation
// ---------------------------------------------------------------------------

async function defaultExecGitDiffStat(cwd: string): Promise<string> {
  const { execFile: execFileCb } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFile = promisify(execFileCb);
  try {
    const { stdout } = await execFile("git", ["diff", "--stat", "HEAD~1", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    try {
      // Fallback: diff against working tree
      const { stdout } = await execFile("git", ["diff", "--stat"], { cwd });
      return stdout.trim() || "(no uncommitted changes)";
    } catch {
      return "(git diff unavailable)";
    }
  }
}

// ---------------------------------------------------------------------------
// buildContextMessage — assembles the context blob sent to @debriefer
// ---------------------------------------------------------------------------

function buildContextMessage(
  loopResult: DebriefOptions["loopResult"],
  prompt: string,
  gitDiffStat: string,
): string {
  const cost =
    loopResult.cumulativeCostUsd !== undefined
      ? `$${loopResult.cumulativeCostUsd.toFixed(4)}`
      : "not available";

  const sessionId = loopResult.sessionId ?? "not available";

  return [
    "## Autopilot session context",
    "",
    `**Exit reason:** ${loopResult.exitReason}`,
    `**Iterations completed:** ${loopResult.iterations}`,
    `**Exit message:** ${loopResult.message}`,
    `**Cumulative cost:** ${cost}`,
    `**Session ID:** ${sessionId}`,
    "",
    "## Original prompt",
    "",
    prompt,
    "",
    "## Git diff stat (last commit vs HEAD~1)",
    "",
    gitDiffStat || "(no changes)",
    "",
    "---",
    "",
    "Please produce the five-section debrief as instructed in your system prompt.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// runDebrief — main entry point
// ---------------------------------------------------------------------------

/**
 * Run the post-loop debrief. Spawns a @debriefer session, sends context,
 * waits for the response, and prints it to stdout.
 *
 * Never throws — on any error, prints a warning to stderr and returns.
 */
export async function runDebrief(opts: DebriefOptions): Promise<void> {
  const _createSession = opts._deps?.createSession ?? createSession;
  const _sendAndWait = opts._deps?.sendAndWait ?? sendAndWait;
  const _getLastAssistantMessage = opts._deps?.getLastAssistantMessage ?? getLastAssistantMessage;
  const _execGitDiffStat = opts._deps?.execGitDiffStat ?? defaultExecGitDiffStat;

  try {
    // Gather git diff stat (non-fatal)
    const gitDiffStat = await _execGitDiffStat(opts.cwd).catch(() => "(git diff unavailable)");

    // Build the context message
    const contextMessage = buildContextMessage(opts.loopResult, opts.prompt, gitDiffStat);

    // Create a new @debriefer session
    const sessionId = await _createSession(opts.server.client, {
      cwd: opts.cwd,
      agentName: "debriefer",
    });

    // Send the context and wait for idle
    await _sendAndWait(opts.server.client, {
      sessionId,
      message: contextMessage,
      stallMs: 5 * 60 * 1000, // 5 min stall timeout for debrief
    });

    // Get the debrief output
    const debriefOutput = await _getLastAssistantMessage(opts.server.client, sessionId);

    if (debriefOutput) {
      process.stdout.write("\n\x1b[1m─── Autopilot Debrief ───\x1b[0m\n\n");
      process.stdout.write(debriefOutput);
      process.stdout.write("\n\n");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\x1b[33m⚠ Debrief failed (non-fatal): ${msg}\x1b[0m\n`);
  }
}
