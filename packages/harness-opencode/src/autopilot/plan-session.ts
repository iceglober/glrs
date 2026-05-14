/**
 * Plan session runner for the interactive autopilot orchestrator.
 *
 * Runs a headless opencode session with the @plan agent, sends the
 * scope path as the prompt, and detects the plan output path from
 * the filesystem (multi-file directory or single-file .md).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  startServer,
  createSession,
  sendAndWait,
} from "../lib/opencode-server.js";
import type { PlanSessionOptions, PlanSessionResult } from "./interactive.js";

export type { PlanSessionOptions, PlanSessionResult };

const DEFAULT_PLAN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Injectable server dependencies for testing.
 * @internal
 */
export interface PlanSessionDeps {
  startServer?: typeof import("../lib/opencode-server.js").startServer;
  createSession?: typeof import("../lib/opencode-server.js").createSession;
  sendAndWait?: typeof import("../lib/opencode-server.js").sendAndWait;
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
  opts: PlanSessionOptions & { timeoutMs?: number; _deps?: PlanSessionDeps },
): Promise<PlanSessionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;

  // Resolve server functions — use injected deps in tests, real impls in prod
  const _startServer = opts._deps?.startServer ?? startServer;
  const _createSession = opts._deps?.createSession ?? createSession;
  const _sendAndWait = opts._deps?.sendAndWait ?? sendAndWait;
  const _existsSync = opts._deps?.existsSync ?? fs.existsSync;

  const server = await _startServer({ cwd: opts.planDir });

  try {
    const sessionId = await _createSession(server.client, {
      cwd: opts.planDir,
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
    const result = await _sendAndWait(server.client, {
      sessionId,
      message: prompt,
      agentName: "plan",
      stallMs: timeoutMs,
      autoRejectPermissions: true,
      serverUrl: server.url,
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
      process.stderr.write(
        `\n  ⚠ @plan tried to ask a question (rejected). Checking if plan was written anyway...\n`,
      );
    }

    // Detect which plan output was produced
    if (_existsSync(multiFileMain)) {
      // Multi-file plan: return the directory path
      return { planPath: multiFileDir };
    }

    if (_existsSync(singleFilePlan)) {
      // Single-file plan
      return { planPath: singleFilePlan };
    }

    throw new Error(
      `@plan session completed but produced no plan file. ` +
        `Expected either ${multiFileMain} or ${singleFilePlan}.`,
    );
  } finally {
    await server.shutdown();
  }
}
