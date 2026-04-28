/**
 * Pilot worker loop.
 *
 * Single-worker for v0.1. Picks a ready task from the scheduler,
 * prepares a worktree, opens an opencode session, sends the kickoff
 * prompt, waits for idle, runs verify, enforces touches, commits,
 * marks succeeded — or fails with the appropriate state transition
 * and event log on any failure mode along the way.
 *
 * The function `runWorker(deps)` consumes a dependency bag — every
 * subsystem (state, scheduler, pool, bus, runner, prompts) is
 * injected. This makes the worker testable: pass in mocks and observe
 * the resulting state-DB transitions.
 *
 * The worker DOES NOT spawn the opencode server itself — that's the
 * caller's job (the CLI's `pilot build`). The dep bag includes a
 * pre-built `client` and `bus`. The worker also doesn't open the DB
 * or create the run — both are passed in.
 *
 * Main loop semantics:
 *
 *   while not complete:
 *     pick = scheduler.next()
 *     if pick is null:
 *       break  (no ready tasks; either everything's done OR all
 *               remaining tasks are blocked on deps that haven't
 *               settled yet, in which case the scheduler's
 *               isComplete() is also false; we loop with a tiny
 *               delay until something changes)
 *     await runOneTask(pick.task)
 *
 * v0.1 has only one worker, so the "blocked on in-flight task" case
 * cannot happen — once `next()` returns null, the run is done.
 *
 * Per-task lifecycle (with all the failure handling):
 *
 *   1. pool.prepare → sinceSha, branch, path
 *   2. session.create → sessionId
 *   3. state.markRunning(sessionId, branch, path)
 *   4. attempt loop (up to maxAttempts):
 *      a. promptAsync(kickoff or fix prompt)
 *      b. bus.waitForIdle
 *         - kind:"stall" → state.markFailed("stall"); pool.preserve
 *         - kind:"abort" → state.markAborted; pool.preserve
 *         - kind:"session-error" → mark failed; pool.preserve
 *         - kind:"idle" → continue
 *      c. STOP detected during waitForIdle → markFailed; pool.preserve
 *      d. runVerify
 *         - on fail with attempts remaining: build fixPrompt, loop
 *         - on fail with no attempts left: markFailed; pool.preserve
 *         - on success: enforceTouches
 *      e. enforceTouches
 *         - violation: mark failed (if no attempts left) OR
 *           build fixPrompt with touchesViolators and loop
 *         - clean: commitAll → markSucceeded
 *
 *   5. cascadeFail dependents on failure
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

import type { Plan, PlanTask } from "../plan/schema.js";
import type { Scheduler } from "../scheduler/ready-set.js";
import type { WorktreePool, WorktreeSlot } from "../worktree/pool.js";
import type { EventBus, EventLike } from "../opencode/events.js";

import {
  markRunning,
  markSucceeded,
  markFailed,
  markAborted,
  markBlocked,
  setCostUsd,
  getTask,
  listTasks,
} from "../state/tasks.js";
import { appendEvent } from "../state/events.js";
import { kickoffPrompt, fixPrompt, type LastFailure, type RunContext } from "../opencode/prompts.js";
import { runVerify } from "../verify/runner.js";
import { enforceTouches } from "../verify/touches.js";
import { commitAll, headSha } from "../worktree/git.js";
import { getTaskJsonlPath } from "../paths.js";
import { StopDetector } from "./stop-detect.js";

// --- Public types ----------------------------------------------------------

export type WorkerDeps = {
  db: Database;
  runId: string;
  plan: Plan;
  scheduler: Scheduler;
  pool: WorktreePool;
  client: OpencodeClient;
  /**
   * Factory that produces a per-task EventBus scoped to the given
   * worktree directory. The factory must scope its SSE subscription
   * to that directory (via `new EventBus(client, directory)`) — the
   * opencode server's `/event` endpoint filters session-level events
   * by subscriber directory, and a bus without a directory receives
   * only server-wide events (heartbeats, connected, file-watcher).
   *
   * Why a factory instead of a single shared bus: opencode's SSE
   * directory-scope is exact-match, not prefix-match. A single bus
   * scoped to the run's worktrees-parent directory receives ZERO
   * events for per-task sessions whose directories are children of
   * that parent. Each task must therefore have its own bus scoped to
   * its own worktree.
   *
   * Contract: the worker creates ONE bus per task and closes it at
   * task end (in the same `finally`-style cleanup block that disposes
   * forensics). Callers (build.ts) wire this up as
   * `(directory) => new EventBus(client, directory)`.
   */
  busFactory: (directory: string) => EventBus;

  /**
   * Branch prefix derived from the plan slug (e.g. `pilot/eng-1234`).
   * The worker forms each task's branch as `<branchPrefix>/<task.id>`.
   */
  branchPrefix: string;

  /** Base ref the worktree is created from (typically `main` HEAD). */
  base: string;

  /**
   * Maximum verify-fix iterations per task. Default 3. Each iteration
   * is one prompt + one verify. The kickoff is iteration 1; fixes are
   * 2..maxAttempts.
   */
  maxAttempts?: number;

  /**
   * Stall timeout per `waitForIdle`. Default 5 minutes (matches the
   * EventBus default).
   */
  stallMs?: number;

  /**
   * Optional abort signal — when fired, the worker:
   *   1. Aborts the in-flight session (`session.abort`).
   *   2. Marks the running task `aborted`.
   *   3. Returns from `runWorker` with `{ aborted: true }`.
   */
  abortSignal?: AbortSignal;

  /**
   * Optional `onLine` callback for verify-runner output. Pipes the
   * worker's per-attempt verify output to e.g. a JSONL log.
   */
  onVerifyLine?: Parameters<typeof runVerify>[1]["onLine"];

  /**
   * Author name/email for `commitAll`. The CLI sources these from
   * the user's git config or from a pilot-specific override.
   */
  authorName?: string;
  authorEmail?: string;
};

export type WorkerResult = {
  /** True if the worker observed an abort signal. */
  aborted: boolean;
  /** Task IDs the worker attempted (in order). */
  attempted: string[];
};

// --- Public API ------------------------------------------------------------

/**
 * Run the worker until the scheduler reports nothing more is ready.
 *
 * Returns a summary; deeper detail lives in the events table and the
 * task rows (the CLI's `pilot status` is the consumer).
 */
export async function runWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const attempted: string[] = [];
  const maxAttempts = deps.maxAttempts ?? 3;
  // Default 60min per waitForIdle. Tasks legitimately do minutes of
  // work between events — planning passes, tool-heavy grounding
  // phases, plan-reviewer delegations. 5min (the pre-v0.16.2 default)
  // was only ever long enough because the stream was broken and no
  // events ever fired anyway; with events flowing, the wait timer
  // measures real-world inter-event gaps, which can exceed 5min for
  // deep subagent work. Users can still override per-run via the
  // `stallMs` arg on `runWorker`.
  const stallMs = deps.stallMs ?? 60 * 60 * 1000;

  // Flag set by runOneTask when setup fails — signals the run should
  // abort without picking further tasks.
  let setupAborted = false;
  const depsWithAbort = deps as WorkerDeps & { setupAborted?: boolean };

  while (true) {
    if (deps.abortSignal?.aborted) {
      return { aborted: true, attempted };
    }
    const pick = deps.scheduler.next();
    if (pick === null) {
      // No more ready tasks. v0.1 has no concurrency, so this means
      // the run is structurally done.
      return { aborted: false, attempted };
    }
    attempted.push(pick.task.id);
    await runOneTask(depsWithAbort, pick.task, { maxAttempts, stallMs });

    // Check if setup failed and aborted the run.
    if (depsWithAbort.setupAborted) {
      return { aborted: false, attempted };
    }

    // After each task, cascadeFail handles downstream blocking. The
    // call is a no-op when the task succeeded.
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

/**
 * Per-task forensics: the JSONL writer for SSE events + the
 * last-event-ts / event-count counters read by stall payloads.
 *
 * One `Forensics` instance lives for the duration of a single task's
 * session. It:
 *   - Subscribes to the bus for the task's session exactly once.
 *   - Appends every incoming event as a JSON line to the task's
 *     session.jsonl (`<runDir>/tasks/<taskId>/session.jsonl`).
 *   - Tracks `lastEventTs` + `eventCount` so the stall handler can
 *     surface "N events, last Xms ago" in the task.failed payload.
 *
 * Every failure path in `runOneTask` MUST call `dispose()` before
 * returning — otherwise the bus keeps calling the handler long after
 * the task has moved on.
 */
type Forensics = {
  /** Snapshot current counters; safe to read repeatedly. */
  counters(): { lastEventTs: number | null; eventCount: number };
  /** Unsubscribe and close the JSONL writer. Idempotent. */
  dispose(): void;
  /** Path to the JSONL file (for testing / debugging). */
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

  // Ensure the file exists (empty JSONL is still a valid zero-line file).
  // Parent directory is already created by getTaskJsonlPath.
  try {
    fsSync.appendFileSync(args.jsonlPath, "");
  } catch {
    // If the initial touch fails, later appendFileSync calls will also
    // fail — we swallow both; forensics are best-effort.
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
      // Forensics failure must NOT fail the task; swallow.
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

async function runOneTask(
  deps: WorkerDeps,
  task: PlanTask,
  opts: { maxAttempts: number; stallMs: number },
): Promise<void> {
  const cwd = process.cwd();
  appendEvent(deps.db, {
    runId: deps.runId,
    taskId: task.id,
    kind: "task.started",
    payload: {},
  });

  // 1. Acquire + prepare worktree.
  let slot: WorktreeSlot;
  let prepared: { sinceSha: string; branch: string; path: string };
  try {
    slot = deps.pool.acquire();
    prepared = await deps.pool.prepare({
      slot,
      taskId: task.id,
      branchPrefix: deps.branchPrefix,
      base: deps.base,
    });
  } catch (err) {
    const reason = `worktree prepare failed: ${errorMessage(err)}`;
    // Mark failed without ever transitioning to running — the state
    // module allows markFailed from `pending` (Phase B2).
    try {
      // Need to land in `ready` first since markFailed allows ready/running.
      // But we may already be in ready (scheduler.next did that).
      const row = getTask(deps.db, deps.runId, task.id);
      if (row?.status === "pending") {
        // We never moved to ready — markFailed expects ready/running.
        // Roll forward: mark ready, then fail. (The schema's CHECK
        // doesn't care about the intermediate.)
        // Practically scheduler.next() already moved to ready, so
        // this branch is rare.
        deps.scheduler.next(); // best-effort to mark ready (no-op if other tasks)
      }
      markFailed(deps.db, deps.runId, task.id, reason);
    } catch {
      // already in some terminal state — give up gracefully.
    }
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.failed",
      payload: { phase: "prepare", reason },
    });
    return;
  }

  // 2. Run setup commands (if any) once per fresh slot before session.create.
  //    Setup runs after prepare (worktree exists) and before session.create
  //    (session needs the dir but not installed deps).
  const setupCommands = deps.plan.setup ?? [];
  if (setupCommands.length > 0 && !slot.setupCompleted) {
    const setupStart = Date.now();
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "slot.setup.started",
      payload: {
        slotIndex: slot.index,
        commands: deps.plan.setup,
        taskId: task.id,
      },
    });

    const setupResult = await runVerify(setupCommands, {
      cwd: prepared.path,
      abortSignal: deps.abortSignal,
      onLine: deps.onVerifyLine,
    });

    if (!setupResult.ok) {
      const durationMs = Date.now() - setupStart;
      const failure = setupResult.failure;
      const reason = `setup failed: ${failure.command} → exit ${failure.exitCode}`;
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "slot.setup.failed",
        payload: {
          slotIndex: slot.index,
          command: failure.command,
          exitCode: failure.exitCode,
          output: failure.output.slice(0, 4096), // truncate
          durationMs,
        },
      });
      // Mark current task failed with phase=setup, preserve slot, and abort run.
      deps.pool.preserveOnFailure(slot);
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      // Cascade-block all remaining tasks. Setup failure aborts the
      // whole run, so we block EVERY pending/ready task (including
      // ones with no dependency on `task.id`): an uninstalled node_modules
      // tree means independent tasks can't succeed either. `cascadeFail`
      // only walks dependents; we follow it up with an explicit sweep
      // for the independent-pending case.
      const blocked = new Set(
        deps.scheduler.cascadeFail(task.id, reason),
      );
      // Sweep every other pending/ready task in the run. `cascadeFail`
      // skips terminal states, so this sweep never transitions out of
      // one either.
      for (const row of listTasks(deps.db, deps.runId)) {
        if (row.task_id === task.id) continue;
        if (blocked.has(row.task_id)) continue;
        if (row.status !== "pending" && row.status !== "ready") continue;
        try {
          markBlocked(deps.db, deps.runId, row.task_id, reason);
          blocked.add(row.task_id);
        } catch {
          // Racy edge (e.g., task is `running` in another worker). Skip.
        }
      }
      for (const blockedId of blocked) {
        appendEvent(deps.db, {
          runId: deps.runId,
          taskId: blockedId,
          kind: "task.blocked",
          payload: { reason, failedDep: task.id },
        });
      }
      // Signal runWorker to stop picking new tasks.
      (deps as WorkerDeps & { setupAborted?: boolean }).setupAborted = true;
      return;
    }

    // Setup succeeded — cache and emit completion event.
    slot.setupCompleted = true;
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "slot.setup.completed",
      payload: {
        slotIndex: slot.index,
        durationMs: Date.now() - setupStart,
      },
    });
  }

  // 3. Open session.
  let sessionId: string;
  try {
    const created = await deps.client.session.create({
      body: { title: `pilot/${deps.runId}/${task.id}` },
      query: { directory: prepared.path },
    });
    if (!created.data?.id) {
      throw new Error(`session.create returned no id`);
    }
    sessionId = created.data.id;
  } catch (err) {
    const reason = `session.create failed: ${errorMessage(err)}`;
    deps.pool.preserveOnFailure(slot);
    markFailedSafe(deps.db, deps.runId, task.id, reason);
    appendEvent(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      kind: "task.failed",
      payload: { phase: "session.create", reason },
    });
    return;
  }

  // 2b. Open a per-task EventBus scoped to the worktree directory.
  //     opencode's SSE `/event` endpoint filters session-level events
  //     by subscriber directory (exact-match). Without this scope the
  //     bus receives only server-wide events (heartbeats, file-watcher),
  //     never session.idle / message.updated / message.part.updated —
  //     which is what caused pilot to "stall" for every task until
  //     v0.16.2. One bus per task; torn down alongside forensics.
  const bus = deps.busFactory(prepared.path);
  // Give the SSE stream a moment to connect before the caller starts
  // sending prompts. Without this, fast tasks can complete their
  // first message.part.updated before our subscription handshake
  // finishes, and we'd miss it.
  await new Promise((r) => setTimeout(r, 200));
  const disposeBus = async () => {
    try {
      await bus.close();
    } catch {
      // closing is best-effort; never fail a task on teardown
    }
  };

  // 2c. Open forensics — JSONL writer + counters — before any bus
  // traffic we care about. Must be disposed before every return path
  // below; helper `finishForensics` closes over this scope.
  let forensics: Forensics | null = null;
  try {
    const jsonlPath = await getTaskJsonlPath(cwd, deps.runId, task.id);
    forensics = openForensics({ bus, sessionId, jsonlPath });
  } catch {
    // Forensics failure must not fail the task — swallow.
    forensics = null;
  }
  const disposeForensics = () => {
    if (forensics) forensics.dispose();
    // Fire-and-forget bus close — the caller doesn't need to await
    // since the subsequent task gets its own fresh bus anyway.
    void disposeBus();
  };
  const forensicsCounters = () =>
    forensics ? forensics.counters() : { lastEventTs: null, eventCount: 0 };

  // 3. Mark running with the session/branch/worktree info.
  try {
    markRunning(deps.db, {
      runId: deps.runId,
      taskId: task.id,
      sessionId,
      branch: prepared.branch,
      worktreePath: prepared.path,
    });
  } catch (err) {
    // Race or invariant violation; fail gracefully.
    disposeForensics();
    deps.pool.preserveOnFailure(slot);
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
    payload: { sessionId, branch: prepared.branch, worktreePath: prepared.path },
  });

  // 4. Attempt loop.
  const ctx: RunContext = {
    planName: deps.plan.name,
    branch: prepared.branch,
    worktreePath: prepared.path,
    milestone: task.milestone,
    verifyAfterEach: deps.plan.defaults.verify_after_each,
    verifyMilestone:
      task.milestone !== undefined
        ? deps.plan.milestones.find((m) => m.name === task.milestone)?.verify ?? []
        : [],
  };

  const allVerify = [
    ...task.verify,
    ...deps.plan.defaults.verify_after_each,
    ...ctx.verifyMilestone,
  ];

  let lastFailure: LastFailure | null = null;
  let stopReason: string | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (deps.abortSignal?.aborted) {
      await abortSession(deps, sessionId);
      markAbortedSafe(deps.db, deps.runId, task.id, "abort signal");
      disposeForensics();
      deps.pool.preserveOnFailure(slot);
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

    // Subscribe a stop detector for this session (single-shot).
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

    // Send the prompt.
    try {
      await deps.client.session.promptAsync({
        path: { id: sessionId },
        query: { directory: prepared.path },
        body: {
          agent: task.agent ?? deps.plan.defaults.agent,
          parts: [{ type: "text", text: promptText }],
        },
      });
    } catch (err) {
      unsubStop();
      const reason = `promptAsync failed: ${errorMessage(err)}`;
      disposeForensics();
      deps.pool.preserveOnFailure(slot);
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "promptAsync", reason },
      });
      return;
    }

    // Wait for idle (or stall / abort / session-error).
    const idleResult = await bus.waitForIdle(sessionId, {
      stallMs: opts.stallMs,
      abortSignal: deps.abortSignal,
    });
    unsubStop();

    // Update cost (best-effort) on every idle (whether or not the
    // outcome was idle — cost may have accrued before a stall).
    await pollCost(deps, sessionId, task.id);

    if (idleResult.kind === "abort") {
      await abortSession(deps, sessionId);
      markAbortedSafe(deps.db, deps.runId, task.id, "abort signal");
      disposeForensics();
      deps.pool.preserveOnFailure(slot);
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
        // best effort
      }
      disposeForensics();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      deps.pool.preserveOnFailure(slot);
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
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      deps.pool.preserveOnFailure(slot);
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

    // STOP detected during the wait.
    if (stopReason !== null) {
      disposeForensics();
      markFailedSafe(deps.db, deps.runId, task.id, stopReason);
      deps.pool.preserveOnFailure(slot);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.stopped",
        payload: { reason: stopReason },
      });
      return;
    }

    // 5. Verify.
    const verifyResult = await runVerify(allVerify, {
      cwd: prepared.path,
      abortSignal: deps.abortSignal,
      onLine: deps.onVerifyLine,
    });

    if (!verifyResult.ok) {
      lastFailure = {
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
          command: lastFailure.command,
          exitCode: lastFailure.exitCode,
          timedOut: verifyResult.failure.timedOut,
          aborted: verifyResult.failure.aborted,
        },
      });
      // Aborted-during-verify: same disposition as abort during idle.
      if (verifyResult.failure.aborted) {
        disposeForensics();
        markAbortedSafe(deps.db, deps.runId, task.id, "abort signal during verify");
        deps.pool.preserveOnFailure(slot);
        return;
      }
      // Try again if attempts remain.
      if (attempt < opts.maxAttempts) continue;
      // Out of attempts.
      const reason = `verify failed after ${opts.maxAttempts} attempts: ${lastFailure.command} → exit ${lastFailure.exitCode}`;
      disposeForensics();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      deps.pool.preserveOnFailure(slot);
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
      payload: { attempt },
    });

    // 6. Enforce touches.
    const touches = await enforceTouches({
      worktree: prepared.path,
      sinceSha: prepared.sinceSha,
      allowed: task.touches,
    });
    if (!touches.ok) {
      // Build a touches-violation fixPrompt and try again if attempts remain.
      lastFailure = {
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
      if (attempt < opts.maxAttempts) continue;
      const reason = `touches violation after ${opts.maxAttempts} attempts: ${touches.violators.join(", ")}`;
      disposeForensics();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      deps.pool.preserveOnFailure(slot);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "touches", reason, attempts: opts.maxAttempts },
      });
      return;
    }

    // 7. Commit.
    if (touches.changed.length === 0) {
      // No edits — verify passed but nothing to commit. This is
      // legitimate for verify-only tasks; mark succeeded without
      // commit.
      disposeForensics();
      markSucceeded(deps.db, deps.runId, task.id);
      deps.pool.release(slot);
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
      const sha = await commitAll({
        worktree: prepared.path,
        message: commitMessage,
        authorName: deps.authorName,
        authorEmail: deps.authorEmail,
      });
      disposeForensics();
      markSucceeded(deps.db, deps.runId, task.id);
      deps.pool.release(slot);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.succeeded",
        payload: { commit: sha, changed: touches.changed },
      });
      return;
    } catch (err) {
      const reason = `commit failed: ${errorMessage(err)}`;
      disposeForensics();
      markFailedSafe(deps.db, deps.runId, task.id, reason);
      deps.pool.preserveOnFailure(slot);
      appendEvent(deps.db, {
        runId: deps.runId,
        taskId: task.id,
        kind: "task.failed",
        payload: { phase: "commit", reason },
      });
      return;
    }
  }

  // Unreachable in normal flow — every loop branch returns.
  // If we DO get here, something went off-script.
  const reason = "worker loop exited unexpectedly";
  disposeForensics();
  markFailedSafe(deps.db, deps.runId, task.id, reason);
  deps.pool.preserveOnFailure(slot);
  appendEvent(deps.db, {
    runId: deps.runId,
    taskId: task.id,
    kind: "task.failed",
    payload: { phase: "worker.exit", reason },
  });
}

// --- Helpers ---------------------------------------------------------------

/**
 * Best-effort cost update. Reads `client.session.get` and copies the
 * cost field (if present) onto the task row.
 *
 * Tolerant of every possible failure — cost reporting is informational
 * for v0.1.
 */
async function pollCost(
  deps: WorkerDeps,
  sessionId: string,
  taskId: string,
): Promise<void> {
  try {
    const r = await deps.client.session.get({
      path: { id: sessionId },
    });
    // Cost may live on the messages aggregate (per the SDK shape: cost
    // is on AssistantMessage, not the Session). Best-effort: try a
    // few common field paths.
    const session = r.data as Record<string, unknown> | undefined;
    let cost: number | null = null;
    if (session && typeof session.cost === "number") {
      cost = session.cost;
    }
    if (cost === null) {
      // Fall back to messages aggregate.
      try {
        const m = await deps.client.session.messages({
          path: { id: sessionId },
        });
        const list = (m.data ?? []) as Array<Record<string, unknown>>;
        let total = 0;
        for (const entry of list) {
          // Each entry shape varies; AssistantMessage has `info.cost`
          // or top-level `cost` depending on the API version.
          const info = (entry.info ?? entry) as Record<string, unknown>;
          const c = typeof info.cost === "number" ? info.cost : 0;
          total += c;
        }
        cost = total;
      } catch {
        // best effort
      }
    }
    if (cost !== null && Number.isFinite(cost) && cost >= 0) {
      try {
        setCostUsd(deps.db, deps.runId, taskId, cost);
      } catch {
        // ignore — cost is informational
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
    // best effort
  }
}

/**
 * Mark failed swallowing illegal-transition errors. Used in error
 * paths where we don't want a secondary state mismatch to mask the
 * primary failure.
 */
function markFailedSafe(
  db: Database,
  runId: string,
  taskId: string,
  reason: string,
): void {
  try {
    markFailed(db, runId, taskId, reason);
  } catch {
    // already in a terminal state (failed/succeeded/aborted/blocked) —
    // leave it.
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

// Avoid unused import warning when headSha is not directly invoked
// by the worker today (it's called via pool.prepare). Keeps the
// import as a reservation for future lifecycle hooks.
void headSha;
