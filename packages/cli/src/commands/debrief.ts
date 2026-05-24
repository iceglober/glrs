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

import type { LoopResult, AgentAdapter, AgentHandle, AdapterName } from "@glrs-dev/autopilot";
import { resolveModel } from "@glrs-dev/autopilot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebriefOptions {
  /** The agent adapter + handle (owned by the CLI). */
  agentHandle: { adapter: AgentAdapter; handle: AgentHandle };
  /** The result from runRalphLoop. */
  loopResult: LoopResult & { sessionId?: string; cumulativeCostUsd?: number };
  /** The original prompt passed to the loop. */
  prompt: string;
  /** Working directory (used for git diff stat). */
  cwd: string;
  /** Autopilot configuration (for model resolution). */
  config?: unknown;
  /**
   * Injectable dependencies for testing.
   * @internal
   */
  _deps?: {
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

  const lines = [
    "## Autopilot session context",
    "",
    `**Exit reason:** ${loopResult.exitReason}`,
    `**Iterations completed:** ${loopResult.iterations}`,
    `**Exit message:** ${loopResult.message}`,
    `**Cumulative cost:** ${cost}`,
    `**Session ID:** ${sessionId}`,
  ];

  // Per-phase cost breakdown (multi-phase plans only)
  if (loopResult.phaseBreakdown && loopResult.phaseBreakdown.length > 0) {
    lines.push("");
    lines.push("## Per-phase cost breakdown");
    lines.push("");
    for (const phase of loopResult.phaseBreakdown) {
      const phaseCost = phase.costUsd > 0 ? `$${phase.costUsd.toFixed(4)}` : "n/a";
      lines.push(`- **${phase.phaseFile}**: ${phase.iterations} iteration(s), ${phaseCost}`);
    }
  }

  // Per-lane cost breakdown (parallel-lane runs only — item 3.5).
  // Only emitted when there's > 1 lane to avoid noise on sequential runs.
  if (loopResult.laneCosts && loopResult.laneCosts.size > 1) {
    lines.push("");
    lines.push("## Per-lane cost breakdown");
    lines.push("");
    const sortedLanes = [...loopResult.laneCosts.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    let total = 0;
    for (const [laneId, laneCost] of sortedLanes) {
      total += laneCost;
      const fmt = laneCost > 0 ? `$${laneCost.toFixed(4)}` : "n/a";
      lines.push(`- **${laneId}**: ${fmt}`);
    }
    lines.push(`- **total**: $${total.toFixed(4)}`);
  }

  // Orphaned worktrees from partial-failure runs (item 3.6).
  if (loopResult.orphanedWorktrees && loopResult.orphanedWorktrees.length > 0) {
    lines.push("");
    lines.push("## Orphaned worktrees");
    lines.push("");
    lines.push(
      "The following worktrees survived the run because their merge failed.",
    );
    lines.push("Resolve manually with `git worktree remove --force <path>`.");
    lines.push("");
    for (const wt of loopResult.orphanedWorktrees) {
      lines.push(`- ${wt}`);
    }
  }

  // Verify-command results from the post-phase test gate (item 4.1).
  // Only emitted when at least one phase ran a verify command — silent
  // when no plan items declared a `verify:` field.
  if (loopResult.verifyResults && loopResult.verifyResults.length > 0) {
    lines.push("");
    lines.push("## Verify command results");
    lines.push("");
    for (const phase of loopResult.verifyResults) {
      const passed = phase.results.filter((r) => r.passed).length;
      const total = phase.results.length;
      lines.push(`### ${phase.phaseFile} — ${passed}/${total} passed`);
      lines.push("");
      lines.push("| Item | Command | Result | Duration |");
      lines.push("| --- | --- | --- | --- |");
      for (const r of phase.results) {
        const cmd =
          r.command.length > 60 ? r.command.slice(0, 57) + "..." : r.command;
        const status = r.passed ? "✓ pass" : "✗ fail";
        const dur =
          r.durationMs < 1000
            ? `${r.durationMs}ms`
            : `${(r.durationMs / 1000).toFixed(1)}s`;
        lines.push(`| ${r.itemId} | \`${cmd}\` | ${status} | ${dur} |`);
      }
      lines.push("");
    }
  }

  lines.push(
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
  );

  return lines.join("\n");
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
  const _execGitDiffStat = opts._deps?.execGitDiffStat ?? defaultExecGitDiffStat;
  const { adapter, handle } = opts.agentHandle;

  try {
    // Gather git diff stat (non-fatal)
    const gitDiffStat = await _execGitDiffStat(opts.cwd).catch(() => "(git diff unavailable)");

    // Build the context message
    const contextMessage = buildContextMessage(opts.loopResult, opts.prompt, gitDiffStat);

    // Create a new @debriefer session
    const adapterName = adapter.name as AdapterName;
    const cfgObj = opts.config as Record<string, unknown> | undefined;
    const models = cfgObj?.models as Record<string, unknown> | undefined;
    const debriefSpecifier = models?.debrief as string | undefined;
    const debriefModel = debriefSpecifier
      ? resolveModel(debriefSpecifier, adapterName)
      : undefined;
    const sessionId = await adapter.createSession(handle, {
      agentName: "debriefer",
      model: debriefModel,
    });

    // Send the context and wait for idle
    await adapter.sendAndWait(handle, {
      sessionId,
      message: contextMessage,
      stallMs: 5 * 60 * 1000, // 5 min stall timeout for debrief
    });

    // Get the debrief output
    const debriefOutput = await adapter.getLastResponse(handle, sessionId);

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
