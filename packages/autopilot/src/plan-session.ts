/**
 * Plan session runner for the interactive autopilot orchestrator.
 *
 * Runs a headless opencode session with the @plan agent, sends the
 * scope path as the prompt, and detects the plan output path from
 * the filesystem (multi-file directory or single-file .md).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PlanSessionOptions, PlanSessionResult } from "./loop-session-types.js";
import type { AgentAdapter } from "./adapter.js";

export type { PlanSessionOptions, PlanSessionResult };

const DEFAULT_PLAN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Injectable server dependencies for testing.
 * @internal
 */
export interface PlanSessionDeps {
  /** Override filesystem existence checks for testing. */
  existsSync?: (p: string) => boolean;
}

/**
 * Run a headless @plan session.
 *
 * Starts an opencode server, creates a session with the @plan agent,
 * sends a prompt instructing it to read the scope and produce a plan,
 * then detects the plan output path from the filesystem.
 *
 * @plan is headless — autoRejectPermissions is true so it can't
 * deadlock waiting on a human response.
 */
export async function runPlanSession(
  opts: PlanSessionOptions & { timeoutMs?: number; _deps?: PlanSessionDeps; adapter: AgentAdapter },
): Promise<PlanSessionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;
  const adapter = opts.adapter;

  const _existsSync = opts._deps?.existsSync ?? fs.existsSync;

  const handle = await adapter.start({ cwd: opts.planDir });

  try {
    const sessionId = await adapter.createSession(handle, {
      agentName: "plan",
    });

    const multiFileDir = path.join(opts.planDir, opts.slug);
    const multiFileMain = path.join(multiFileDir, "main.md");
    const singleFilePlan = path.join(opts.planDir, `${opts.slug}.md`);

    const prompt =
      `Read the scope at ${opts.scopePath} and produce a plan. ` +
      `Use slug ${opts.slug} for the plan file(s). ` +
      `If the scope warrants multiple phases, produce a multi-file plan at ` +
      `${multiFileDir}/main.md + phase_N.md files. ` +
      `Otherwise produce a single-file plan at ${singleFilePlan}.`;

    // @plan is headless — auto-reject permissions so it can't deadlock
    const result = await adapter.sendAndWait(handle, {
      sessionId,
      message: prompt,
      stallMs: timeoutMs,
    });

    if (result.kind === "abort") {
      throw new Error(
        `Plan session aborted (timeout after ${timeoutMs}ms).`,
      );
    }

    if (result.kind === "stall") {
      throw new Error(
        `Plan session stalled for ${result.stallMs}ms with no idle signal.`,
      );
    }

    if (result.kind === "error") {
      throw new Error(`Plan session error: ${result.message}`);
    }

    if (result.kind === "question_rejected") {
      // @plan tried to ask a question — it was rejected. The agent
      // may still have written the plan before asking. Check disk.
      // If no plan exists, re-send with a reminder (same pattern as
      // the Ralph loop's question-rejection recovery).
    }

    // Detect which plan output was produced
    if (_existsSync(multiFileMain)) {
      return { planPath: multiFileDir };
    }
    if (_existsSync(singleFilePlan)) {
      return { planPath: singleFilePlan };
    }

    // No plan file found — retry with an explicit reminder
    const retryPrompt =
      `You did not write a plan file. Write the plan NOW. ` +
      `Read the scope at ${opts.scopePath}. ` +
      `Write the plan to ${singleFilePlan} (single-file) or ${multiFileDir}/main.md (multi-file). ` +
      `Do NOT ask questions. Just write the plan.`;

    const retryResult = await adapter.sendAndWait(handle, {
      sessionId,
      message: retryPrompt,
      stallMs: timeoutMs,
    });

    if (retryResult.kind !== "idle" && retryResult.kind !== "question_rejected") {
      throw new Error(`@plan retry failed: ${retryResult.kind}`);
    }

    // Check again after retry
    if (_existsSync(multiFileMain)) {
      return { planPath: multiFileDir };
    }
    if (_existsSync(singleFilePlan)) {
      return { planPath: singleFilePlan };
    }

    // Still nothing — construct a minimal plan from the scope
    const scopeContent = fs.existsSync(opts.scopePath)
      ? fs.readFileSync(opts.scopePath, "utf-8")
      : `# Plan\n\nScope file not found at ${opts.scopePath}.`;

    const minimalPlan = [
      `# Plan (auto-generated from scope)`,
      "",
      "This plan was auto-generated because @plan did not produce a plan file.",
      "Review and refine before executing.",
      "",
      scopeContent,
      "",
      "## Acceptance criteria",
      "",
      "- [ ] Review and refine this auto-generated plan",
      "",
      "## File-level changes",
      "",
      "- To be determined after plan review.",
    ].join("\n");

    fs.mkdirSync(path.dirname(singleFilePlan), { recursive: true });
    fs.writeFileSync(singleFilePlan, minimalPlan);
    return { planPath: singleFilePlan };
  } finally {
    await adapter.shutdown(handle);
  }
}
