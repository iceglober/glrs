/**
 * Pilot worker loop — cwd mode.
 *
 * Picks a ready task from the scheduler, opens an opencode session
 * scoped to the user's cwd, sends the kickoff prompt, waits for idle,
 * runs verify, enforces touches, commits on HEAD — or fails with the
 * appropriate state transition and event log on any failure mode.
 *
 * The function `runWorker(deps)` consumes a dependency bag — every
 * subsystem (state, scheduler, bus, runner, prompts) is injected. This
 * makes the worker testable: pass in mocks and observe the resulting
 * state-DB transitions.
 *
 * The worker DOES NOT spawn the opencode server itself — that's the
 * caller's job (the CLI's `pilot build`). The dep bag includes a
 * pre-built `client` and `bus`. The worker also doesn't open the DB
 * or create the run — both are passed in.
 *
 * Main loop semantics:
 *
 *   pre-flight: checkCwdSafety(cwd) — refuses on main/master/dirty
 *   while not complete:
 *     pick = scheduler.next()
 *     if pick is null: break
 *     await runOneTask(pick.task)
 *
 * Per-task lifecycle (with all the failure handling):
 *
 *   1. sinceSha = headSha(cwd)
 *   2. session.create (directory: cwd) → sessionId
 *   3. state.markRunning(sessionId, worktreePath=cwd)
 *   4. attempt loop (up to maxAttempts):
 *      a. promptAsync(kickoff or fix prompt)
 *      b. bus.waitForIdle
 *      c. STOP detected → markFailed
 *      d. runVerify
 *      e. enforceTouches
 *   5. commitAll(cwd) on success → markSucceeded
 *   6. cascadeFail dependents on failure
 *
 * Cost tracking:
 *
 *   The worker pulls cost from `client.session.get(sessionId)` after
 *   each idle and updates the task row. v0.1 is reporting-only.
 *
 * Ship-checklist alignment: Phase E1 of `PILOT_TODO.md`.
 */

import type { Database } from "bun:sqlite";
import type { OpencodeClient } from "@opencode-ai/sdk";
import * as fsSync from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify as promisifyUtil } from "node:util";

import type { Plan, PlanTask } from "../plan/schema.js";
import type { Scheduler } from "../scheduler/ready-set.js";
import type { EventBus, EventLike } from "../opencode/events.js";

import {
  markRunning,
  markSucceeded,
  markFailed,
  markAborted,
  setCostUsd,
  getTask,
} from "../state/tasks.js";
import { appendEvent } from "../state/events.js";
import { kickoffPrompt, fixPrompt, type LastFailure, type RunContext } from "../opencode/prompts.js";
import { runVerify } from "../verify/runner.js";
import { enforceTouches } from "../verify/touches.js";
import { getTaskJsonlPath } from "../paths.js";
import { StopDetector } from "./stop-detect.js";
import { checkCwdSafety, headSha } from "./safety-gate.js";
import { registerSession, unregisterSession } from "../mcp/session-registry.js";
import { getRunDir } from "../paths.js";
import { processAttempt, createCircuitBreaker } from "../build/engine.js";

const execFileWorker = promisifyUtil(execFileCb);

/**
 * Commit every tracked + untracked change in `cwd` with the given subject.
 * Returns the new HEAD sha on success. Throws on failure (e.g. nothing to
 * commit, pre-commit hook rejects).
 */
async function commitAll(
  cwd: string,
  subject: string,
  authorName?: string,
  authorEmail?: string,
): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (authorName) env.GIT_AUTHOR_NAME = authorName;
  if (authorEmail) env.GIT_AUTHOR_EMAIL = authorEmail;
  if (authorName) env.GIT_COMMITTER_NAME = authorName;
  if (authorEmail) env.GIT_COMMITTER_EMAIL = authorEmail;

  await execFileWorker("git", ["add", "-A"], { cwd, timeout: 10_000 });
  await execFileWorker("git", ["commit", "-m", subject], {
    cwd,
    timeout: 30_000,
    env,
  });
  const { stdout } = await execFileWorker("git", ["rev-parse", "HEAD"], {
    cwd,
    timeout: 10_000,
  });
  return stdout.toString().trim();
}

/**
 * Reset the working tree to a clean state after a failed/aborted task.
 */
async function resetTree(cwd: string): Promise<boolean> {
  try {
    await execFileWorker("git", ["reset", "--hard", "HEAD"], {
      cwd,
      timeout: 30_000,
    });
    await execFileWorker("git", ["clean", "-fd"], {
      cwd,
      timeout: 30_000,
    });
    return true;
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    process.stderr.write(
      `[pilot] tree cleanup failed: ${(e.stderr ?? e.message ?? "").toString()}
`,
    );
    return false;
  }
}

// --- Public types ----------------------------------------------------------

export type WorkerDeps = {
  db: Database;
  runId: string;
  plan: Plan;
  scheduler: Scheduler;
  client: OpencodeClient;
  /**
   * Factory that produces a per-task EventBus scoped to the given
   * directory. The factory must scope its SSE subscription to that
   * directory (via `new EventBus(client, directory)`) — the opencode
   * server's `/event` endpoint filters session-level events by
   * subscriber directory.
   *
   * Contract: the worker creates ONE bus per task and closes it at
   * task end. Callers (build.ts) wire this up as
   * `(directory) => new EventBus(client, directory)`.
   */
  busFactory: (directory: string) => EventBus;

  /**
   * Maximum verify-fix iterations per task. Default 3.
   */
  maxAttempts?: number;

  /**
   * Stall timeout per `waitForIdle`. Default 60 minutes.
   */
  stallMs?: number;

  /**
   * Optional abort signal — when fired, the worker aborts the in-flight
   * session, marks the running task `aborted`, and returns.
   */
  abortSignal?: AbortSignal;

  /**
   * Optional `onLine` callback for verify-runner output.
   */
  onVerifyLine?: Parameters<typeof runVerify>[1]["onLine"];

  /**
   * Author name/email for `commitAll`. The CLI sources these from
   * the user's git config or from a pilot-specific override.
   */
  authorName?: string;
  authorEmail?: string;

  /**
   * Optional cwd override for testing. Defaults to process.cwd().
   * In cwd mode, this is the directory where the agent edits files
   * and where verify commands run.
   */
  cwd?: string;
};

export type WorkerResult = {
  /** True if the worker observed an abort signal or safety gate refusal. */
  aborted: boolean;
  /** Task IDs the worker attempted (in order). */
  attempted: string[];
};

// --- Public API ------------------------------------------------------------

/**
 * Run the worker until the scheduler reports nothing more is ready.
 *
 * Pre-flight safety gate runs once at the top: refuses if cwd is on
 * main/master/default branch, outside a git repo, or has a dirty tree.
 * After task 1 commits, HEAD has moved; we do NOT re-check the gate.
 *
 * Task failure halts the run (no cascade-sweep beyond direct dependents).
 */
export async function runWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const attempted: string[] = [];
  const maxAttempts = deps.maxAttempts ?? 5;
  const stallMs = deps.stallMs ?? 60 * 60 * 1000;

  // Resolve cwd: tests inject via deps, production falls back to process.cwd().
  const cwd = deps.cwd ?? process.cwd();

  // Pre-flight safety gate — runs exactly once, never re-checked per task.
  const gate = await checkCwdSafety(cwd);
  if (!gate.ok) {
    process.stderr.write(`[pilot] ${gate.reason}\n`);
    return { aborted: true, attempted: [] };
  }
  // Tolerated-dirt warnings (framework noise the user didn't author).
  // Print so the user sees what pilot is ignoring; if they had
  // intentional work in one of these paths they can ctrl-c.
  for (const w of gate.warnings) {
    process.stderr.write(`[pilot] ${w}\n`);
  }

  // Load repo-level pilot config (.glrs/pilot.json). Provides project-wide
  // baseline and after_each commands that apply to every plan.
  const { loadPilotConfig } = await import("./pilot-config.js");
  let pilotConfig: Awaited<ReturnType<typeof loadPilotConfig>>;
  try {
    pilotConfig = await loadPilotConfig(cwd);
  } catch (err) {
    process.stderr.write(
      `[pilot] ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return { aborted: true, attempted: [] };
  }

  while (true) {
    if (deps.abortSignal?.aborted) {
      return { aborted: true, attempted };
    }
    const pick = deps.scheduler.next();
    if (pick === null) {
      return { aborted: false, attempted };
    }
    attempted.push(pick.task.id);
    await runOneTask(deps, pick.task, { maxAttempts, stallMs, cwd, pilotConfig });

    // If the post-task tree cleanup failed, we can't safely continue —
    // subsequent tasks would run on a dirty tree with stale edits from
    // the last task. Halt the run.
    if ((deps as WorkerDeps & { treeCleanupFailed?: boolean })
      .treeCleanupFailed) {
      process.stderr.write(
        `[pilot] halting run: tree cleanup failed after task ${pick.task.id}; ` +
          `subsequent tasks cannot safely run on a dirty tree\n`,
      );
      return { aborted: true, attempted };
    }

    // After each task, cascadeFail handles downstream blocking.
    const row = getTask(deps.db, deps.runId, pick.task.id);
    if (row && (row.status === "failed" || row.status === "aborted")) {
      const blocked = deps.scheduler.cascadeFail(
        pick.task.id,
        `dependency ${JSON.stringify(pick.task.id)} ${row.status}`,
      );
      for (const id of blocked) {
        appendEvent(deps.db, {
          runId: deps.runId,
          taskId: id,
          kind: "task.blocked",
          payload: { reason: row.last_error, failedDep: pick.task.id },
        });
      }
    }
  }
}

// --- One-task workflow -----------------------------------------------------

type Forensics = {
  counters(): { lastEventTs: number | null; eventCount: number };
  dispose(): void;
  jsonlPath: string;
};

function openForensics(args: {
  bus: EventBus;
  sessionId: string;
  jsonlPath: string;
}): Forensics {
  let lastEventTs: number | null = null;
  let eventCount = 0;
  let disposed = false;

  try {
    fsSync.appendFileSync(args.jsonlPath, "");
  } catch {
    // best-effort
  }

  const unsubscribe = args.bus.on(args.sessionId, (event: EventLike) => {
    if (disposed) return;
    const ts = Date.now();
    lastEventTs = ts;
    eventCount += 1;
    try {
      const line = JSON.stringify({ ts, type: event.type, properties: event.properties }) + "\n";
      fsSync.appendFileSync(args.jsonlPath, line);
    } catch {
      // best-effort
    }
  });

  return {
    counters: () => ({ lastEventTs, eventCount }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    },
    jsonlPath: args.jsonlPath,
  };
}

/**
 * Per-task entry. Thin wrapper around `runOneTaskImpl` that enforces the
 * tree-clean-between-tasks invariant: AFTER the task finishes (success
 * OR failure), `git reset --hard HEAD && git clean -fd` runs to guarantee
 * the working tree is pristine for the next task.
 *
 * Success paths have already committed via `commitAll`, so the reset is
 * a no-op there. Failure paths leave partial edits, and this is where
 * they get reverted.
 *
 * If the reset itself fails, we set a run-level flag (`treeCleanupFailed`)
 * on the deps object. The main loop in `runWorker` checks this after each
 * task and halts the run if set — subsequent tasks can't safely run on a
 * dirty tree.
 */
async function runOneTask(
  deps: WorkerDeps,
  task: PlanTask,
  opts: { maxAttempts: number; stallMs: number; cwd: string; pilotConfig: { baseline: readonly string[]; after_each: readonly string[] } },
): Promise<void> {
  try {
    await runOneTaskImpl(deps, task, opts);
  } finally {
    const ok = await resetTree(opts.cwd);
    if (!ok) {
      (deps as WorkerDeps & { treeCleanupFailed?: boolean }).treeCleanupFailed =
        true;
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "run.cleanup.failed",
        payload: {
          reason:
            "git reset --hard HEAD && git clean -fd failed after task; subsequent tasks aborted",
        },
      });
    }
  }
}

async function runOneTaskImpl(
  deps: WorkerDeps,
  task: PlanTask,
  opts: { maxAttempts: number; stallMs: number; cwd: string; pilotConfig: { baseline: readonly string[]; after_each: readonly string[] } },
): Promise<void> {
  const cwd = opts.cwd;
  appendEvent(deps.db, {
    runId: deps.runId,
    taskId: task.id,
    kind: "task.started",
    payload: {},
  });

  // 1. Capture sinceSha at task start (HEAD of the user's branch).
  let sinceSha: string;
  try {
    sinceSha = await headSha(cwd);
  } catch (err) {
    const reason = `headSha failed: ${errorMessage(err)}`;
    markFailedSafe(deps.db, deps.runId, task.id, reason);
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.failed",
      payload: { phase: "headSha", reason },
    });
    return;
  }

  // 2. Open session scoped to cwd.
  let sessionId: string;
  try {
    const created = await deps.client.session.create({
      body: { title: `pilot/${deps.runId}/${task.id}` },
      query: { directory: cwd },
    });
    if (!created.data?.id) {
      throw new Error(`session.create returned no id`);
    }
    sessionId = created.data.id;
  } catch (err) {
    const reason = `session.create failed: ${errorMessage(err)}`;
    markFailedSafe(deps.db, deps.runId, task.id, reason);
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.failed",
      payload: { phase: "session.create", reason },
    });
    return;
  }

  // 3a. Register session in MCP registry for status updates.
  const runDir = await getRunDir(process.cwd(), deps.runId);
  await registerSession({
    runDir,
    sessionId,
    runId: deps.runId,
    taskId: task.id,
  });

  // 2b. Open a per-task EventBus scoped to cwd.
  const bus = deps.busFactory(cwd);
  await new Promise((r) => setTimeout(r, 200));
  const disposeBus = async () => {
    try {
      await bus.close();
    } catch {
      // best-effort
    }
  };

  // 2c. Open forensics.
  let forensics: Forensics | null = null;
  try {
    const jsonlPath = await getTaskJsonlPath(cwd, deps.runId, task.id);
    forensics = openForensics({ bus, sessionId, jsonlPath });
  } catch {
    forensics = null;
  }
  const disposeForensics = () => {
    if (forensics) forensics.dispose();
    void disposeBus();
  };

  // Helper to unregister session from MCP registry.
  // Called alongside disposeForensics in every terminal path.
  const unregisterSessionSafe = async () => {
    try {
      await unregisterSession({ runDir, sessionId });
    } catch {
      // Best-effort cleanup; never fail the task on registry errors.
    }
  };
  const forensicsCounters = () =>
    forensics ? forensics.counters() : { lastEventTs: null, eventCount: 0 };

  // 3. Mark running. In cwd mode, `branch` is empty and `worktreePath` = cwd.
  try {
    markRunning(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      sessionId,
      branch: "",
      worktreePath: cwd,
    });
  } catch (err) {
    disposeForensics();
    const reason = `markRunning failed: ${errorMessage(err)}`;
    markFailedSafe(deps.db, deps.runId, task.id, reason);
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.failed",
      payload: { phase: "markRunning", reason },
    });
    return;
  }

  appendEvent(deps.db, {
    runId: deps.runId,
    taskId: task.id,
    kind: "task.session.created",
    payload: { sessionId, branch: "", worktreePath: cwd },
  });

  // 4. Attempt loop.
  const ctx: RunContext = {
    planName: deps.plan.name,
    branch: "",
    worktreePath: cwd,
    milestone: task.milestone,
    verifyAfterEach: deps.plan.defaults.verify_after_each,
    verifyMilestone:
      task.milestone !== undefined
        ? deps.plan.milestones.find((m) => m.name === task.milestone)?.verify ?? []
        : [],
  };

  // allVerify = task-specific + plan-level + milestone + pilot.json after_each.
  // This is what runs AFTER the agent finishes each attempt.
  const allVerify = [
    ...task.verify,
    ...deps.plan.defaults.verify_after_each,
    ...ctx.verifyMilestone,
    ...opts.pilotConfig.after_each,
  ];

  // baselineVerify = ONLY the broad regression checks (plan-level +
  // milestone + pilot.json). Task-specific verify is EXCLUDED because
  // it often tests code the agent is about to CREATE — of course it
  // fails before the agent starts. That's TDD, not a broken environment.
  //
  // The baseline catches: wrong port, missing migration, cross-package
  // type breakage from prior tasks. It does NOT catch "the test file
  // doesn't exist yet" — that's the agent's job.
  const baselineVerify = [
    ...deps.plan.defaults.verify_after_each,
    ...ctx.verifyMilestone,
    ...opts.pilotConfig.after_each,
    ...opts.pilotConfig.baseline.filter(
      (c) =>
        !deps.plan.defaults.verify_after_each.includes(c) &&
        !ctx.verifyMilestone.includes(c) &&
        !opts.pilotConfig.after_each.includes(c),
    ),
  ];

  // 4a. Baseline check — verify commands must pass on the CLEAN tree
  //     BEFORE the agent starts. If they don't, the task's verify
  //     contract is broken (pre-existing failures, missing infra, wrong
  //     port). Abort immediately with a clear message rather than
  //     wasting the agent's retry budget on something it can't fix.
  if (baselineVerify.length > 0) {
    const baselineResult = await runVerify(baselineVerify, {
      cwd,
      abortSignal: deps.abortSignal,
      onLine: deps.onVerifyLine,
      env: process.env,
    });
    if (!baselineResult.ok) {
      const f = baselineResult.failure;
      const reason =
        `baseline verify failed: ${f.command} → exit ${f.exitCode}. ` +
        `This command fails on the clean tree BEFORE the agent starts — ` +
        `fix your environment or narrow the verify scope.`;
      disposeForensics();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.baseline.failed",
        payload: {
          phase: "baseline",
          command: f.command,
          exitCode: f.exitCode,
          output: f.output.slice(0, 4096),
          reason,
          // Step 1 of pilot redesign: gate descriptor on every
          // verify-derived event. Future LLM/approval gates emit
          // identically-shaped events with a different `gate.kind`.
          gate: { kind: "shell", command: f.command },
        },
      });
      return;
    }
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.baseline.passed",
      payload: {
        commands: allVerify.length,
        gate: { kind: "all", subKind: "shell", count: baselineVerify.length },
      },
    });
  }

  let lastFailure: LastFailure | null = null;
  let stopReason: string | null = null;

  // Create a circuit breaker for this task's attempt loop.
  // Derives config from plan defaults (new retry engine fields).
  const circuitBreaker = createCircuitBreaker({
    db: deps.db,
    runId: deps.runId,
    taskId: task.id,
    config: {
      maxTotalCostUsd: deps.plan.defaults.max_total_cost_usd,
      maxRunWallMs: deps.plan.defaults.max_run_wall_ms,
    },
    startedAtMs: Date.now(),
  });

  // Build engine config from plan defaults.
  const engineConfig = {
    reflexion: deps.plan.defaults.reflexion,
    diversify: deps.plan.defaults.diversify,
    retryStrategy: deps.plan.defaults.retry_strategy,
    circuitBreaker: {
      maxTotalCostUsd: deps.plan.defaults.max_total_cost_usd,
      maxRunWallMs: deps.plan.defaults.max_run_wall_ms,
    },
  };

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (deps.abortSignal?.aborted) {
      await abortSession(deps, sessionId);
      markAbortedSafe(deps.db, deps.runId, task.id, "abort signal");
      disposeForensics();
      await unregisterSessionSafe();
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.aborted",
        payload: { phase: "pre-prompt", reason: "abort signal" },
      });
      return;
    }

    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.attempt",
      payload: { attempt, of: opts.maxAttempts },
    });

    const promptText =
      attempt === 1
        ? kickoffPrompt(task, ctx)
        : fixPrompt(task, lastFailure!);

    let unsubStop = () => {};
    const stopDet = new StopDetector({
      sessionID: sessionId,
      onStop: (d) => {
        stopReason = `STOP: ${d.reason}`;
      },
    });
    unsubStop = bus.on(sessionId, (e: EventLike) => {
      stopDet.consume(e);
    });

    try {
      await deps.client.session.promptAsync({
        path: { id: sessionId },
        query: { directory: cwd },
        body: {
          agent: task.agent ?? deps.plan.defaults.agent,
          parts: [{ type: "text", text: promptText }],
        },
      });
    } catch (err) {
      unsubStop();
      const reason = `promptAsync failed: ${errorMessage(err)}`;
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "promptAsync", reason },
      });
      return;
    }

    const idleResult = await bus.waitForIdle(sessionId, {
      stallMs: opts.stallMs,
      abortSignal: deps.abortSignal,
    });
    unsubStop();

    await pollCost(deps, sessionId, task.id);

    if (idleResult.kind === "abort") {
      await abortSession(deps, sessionId);
      markAbortedSafe(deps.db, deps.runId, task.id, "abort signal");
      disposeForensics();
      await unregisterSessionSafe();
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.aborted",
        payload: { phase: "waitForIdle", reason: "abort signal" },
      });
      return;
    }

    if (idleResult.kind === "stall") {
      const { lastEventTs, eventCount } = forensicsCounters();
      const sinceLast =
        lastEventTs !== null ? `${Date.now() - lastEventTs}ms` : "none";
      const reason =
        `stalled after ${idleResult.stallMs}ms ` +
        `(${eventCount} event${eventCount === 1 ? "" : "s"}, last ${sinceLast})`;
      try {
        await abortSession(deps, sessionId);
      } catch {
        // best-effort
      }
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: {
          phase: "waitForIdle.stall",
          reason,
          stallMs: idleResult.stallMs,
          eventCount,
          lastEventTs,
        },
      });
      return;
    }

    if (idleResult.kind === "session-error") {
      const reason = `session error: ${JSON.stringify(idleResult.properties)}`;
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: {
          phase: "session.error",
          reason,
          properties: idleResult.properties,
        },
      });
      return;
    }

    if (stopReason !== null) {
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, stopReason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.stopped",
        payload: { reason: stopReason },
      });
      return;
    }

    // 5. Verify — runs in cwd with the user's env verbatim.
    const verifyResult = await runVerify(allVerify, {
      cwd,
      abortSignal: deps.abortSignal,
      onLine: deps.onVerifyLine,
      env: process.env,
    });

    if (!verifyResult.ok) {
      const rawFailure: LastFailure = {
        command: verifyResult.failure.command,
        exitCode: verifyResult.failure.exitCode,
        output: verifyResult.failure.output,
      };
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.verify.failed",
        payload: {
          attempt,
          of: opts.maxAttempts,
          command: rawFailure.command,
          exitCode: rawFailure.exitCode,
          timedOut: verifyResult.failure.timedOut,
          aborted: verifyResult.failure.aborted,
          output: verifyResult.failure.output.slice(-2048),
          gate: { kind: "shell", command: rawFailure.command },
        },
      });
      if (verifyResult.failure.aborted) {
        disposeForensics();
        await unregisterSessionSafe();
        markAbortedSafe(deps.db, deps.runId, task.id, "abort signal during verify");
        return;
      }
      if (attempt < opts.maxAttempts) {
        // Route through the retry engine: classify → critic → diversify →
        // retry-strategy → enriched fixPrompt.
        const engineResult = await processAttempt({
          db: deps.db,
          runId: deps.runId,
          taskId: task.id,
          cwd,
          failure: rawFailure,
          attempt,
          maxAttempts: opts.maxAttempts,
          taskPrompt: task.prompt,
          touches: task.touches,
          config: engineConfig,
          circuitBreaker,
        });
        if (engineResult.action === "halt") {
          const reason = `retry engine halted: ${engineResult.reason}`;
          disposeForensics();
          await unregisterSessionSafe();
          markFailedSafe(deps.db, deps.runId, task.id, reason);
          appendEvent(deps.db, {
            runId: deps.runId,
            taskId: task.id,
            kind: "task.failed",
            payload: { phase: "engine.halt", reason, attempt },
          });
          return;
        }
        lastFailure = engineResult.enrichedFailure;
        continue;
      }
      const reason = `verify failed after ${opts.maxAttempts} attempts: ${rawFailure.command} → exit ${rawFailure.exitCode}`;
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "verify", reason, attempts: opts.maxAttempts },
      });
      return;
    }

    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.verify.passed",
      payload: {
        attempt,
        gate: { kind: "all", subKind: "shell", count: allVerify.length },
      },
    });

    // 6. Enforce touches (diff since sinceSha against task.touches).
    //    Union with task.tolerate and built-in DEFAULT_TOLERATE inside
    //    enforceTouches — framework-generated files (next-env.d.ts,
    //    snapshot updates, tsbuildinfo) aren't treated as violations.
    const touches = await enforceTouches({
      cwd,
      sinceSha,
      allowed: task.touches,
      tolerate: task.tolerate,
    });
    if (!touches.ok) {
      const touchesFailure: LastFailure = {
        command: "touches enforcement",
        exitCode: -1,
        output: `out-of-scope edits: ${touches.violators.join(", ")}`,
        touchesViolators: touches.violators,
      };
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.touches.violation",
        payload: { attempt, violators: touches.violators },
      });
      if (attempt < opts.maxAttempts) {
        const engineResult = await processAttempt({
          db: deps.db,
          runId: deps.runId,
          taskId: task.id,
          cwd,
          failure: touchesFailure,
          attempt,
          maxAttempts: opts.maxAttempts,
          taskPrompt: task.prompt,
          touches: task.touches,
          config: engineConfig,
          circuitBreaker,
        });
        if (engineResult.action === "halt") {
          const reason = `retry engine halted: ${engineResult.reason}`;
          disposeForensics();
          await unregisterSessionSafe();
          markFailedSafe(deps.db, deps.runId, task.id, reason);
          appendEvent(deps.db, {
            runId: deps.runId,
            taskId: task.id,
            kind: "task.failed",
            payload: { phase: "engine.halt", reason, attempt },
          });
          return;
        }
        lastFailure = engineResult.enrichedFailure;
        continue;
      }
      const reason = `touches violation after ${opts.maxAttempts} attempts: ${touches.violators.join(", ")}`;
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "touches", reason, attempts: opts.maxAttempts },
      });
      return;
    }

    // 7. Commit on HEAD of the user's current branch.
    if (touches.changed.length === 0) {
      // No edits — verify-only task, mark succeeded without commit.
      disposeForensics();
      await unregisterSessionSafe();
      markSucceeded(deps.db, deps.runId, task.id);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.succeeded",
        payload: { commit: null, changed: [] },
      });
      return;
    }
    try {
      const commitMessage = `${task.id}: ${task.title}`;
      const sha = await commitAll(
        cwd,
        commitMessage,
        deps.authorName,
        deps.authorEmail,
      );
      disposeForensics();
      await unregisterSessionSafe();
      markSucceeded(deps.db, deps.runId, task.id);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.succeeded",
        payload: { commit: sha, changed: touches.changed },
      });
      return;
    } catch (err) {
      // Commit failed — typically a pre-commit hook rejection (TODO
      // scanner, lint-staged, PHI scan, etc.). Classify as environmental
      // and route through the retry engine so the agent can fix the issue.
      const errMsg = errorMessage(err);
      const commitFailure: LastFailure = {
        command: "git commit (pre-commit hook)",
        exitCode: 1,
        output: errMsg.slice(0, 8192),
      };
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.commit.failed",
        payload: { attempt, error: errMsg.slice(0, 4096) },
      });
      if (attempt < opts.maxAttempts) {
        const engineResult = await processAttempt({
          db: deps.db,
          runId: deps.runId,
          taskId: task.id,
          cwd,
          failure: commitFailure,
          attempt,
          maxAttempts: opts.maxAttempts,
          taskPrompt: task.prompt,
          touches: task.touches,
          config: engineConfig,
          circuitBreaker,
        });
        if (engineResult.action === "halt") {
          const reason = `retry engine halted: ${engineResult.reason}`;
          disposeForensics();
          await unregisterSessionSafe();
          markFailedSafe(deps.db, deps.runId, task.id, reason);
          appendEvent(deps.db, {
            runId: deps.runId,
            taskId: task.id,
            kind: "task.failed",
            payload: { phase: "engine.halt", reason, attempt },
          });
          return;
        }
        lastFailure = engineResult.enrichedFailure;
        continue;
      }
      // Out of attempts — terminal failure.
      const reason = `commit failed after ${opts.maxAttempts} attempts: ${errMsg.slice(0, 500)}`;
      disposeForensics();
      await unregisterSessionSafe();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "commit", reason, attempts: opts.maxAttempts },
      });
      return;
    }
  }

  // Unreachable in normal flow.
  const reason = "worker loop exited unexpectedly";
  disposeForensics();
  await unregisterSessionSafe();
  markFailedSafe(deps.db, deps.runId, task.id, reason);
  appendEvent(deps.db, {
    runId: deps.runId,
    taskId: task.id,
    kind: "task.failed",
    payload: { phase: "worker.exit", reason },
  });
}

// --- Helpers ---------------------------------------------------------------

async function pollCost(
  deps: WorkerDeps,
  sessionId: string,
  taskId: string,
): Promise<void> {
  try {
    const r = await deps.client.session.get({
      path: { id: sessionId },
    });
    const session = r.data as Record<string, unknown> | undefined;
    let cost: number | null = null;
    if (session && typeof session.cost === "number") {
      cost = session.cost;
    }
    if (cost === null) {
      try {
        const m = await deps.client.session.messages({
          path: { id: sessionId },
        });
        const list = (m.data ?? []) as Array<Record<string, unknown>>;
        let total = 0;
        for (const entry of list) {
          const info = (entry.info ?? entry) as Record<string, unknown>;
          const c = typeof info.cost === "number" ? info.cost : 0;
          total += c;
        }
        cost = total;
      } catch {
        // best-effort
      }
    }
    if (cost !== null && Number.isFinite(cost) && cost >= 0) {
      try {
        setCostUsd(deps.db, deps.runId, taskId, cost);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

async function abortSession(
  deps: WorkerDeps,
  sessionId: string,
): Promise<void> {
  try {
    await deps.client.session.abort({ path: { id: sessionId } });
  } catch {
    // best-effort
  }
}

function markFailedSafe(
  db: Database,
  runId: string,
  taskId: string,
  reason: string,
): void {
  try {
    markFailed(db, runId, taskId, reason);
  } catch {
    // already terminal
  }
}

function markAbortedSafe(
  db: Database,
  runId: string,
  taskId: string,
  reason: string,
): void {
  try {
    markAborted(db, runId, taskId, reason);
  } catch {
    // ignore
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
