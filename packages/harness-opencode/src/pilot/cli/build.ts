/**
 * `pilot build` — execute a pilot.yaml plan via the worker loop.
 *
 * Wires every Phase A-F primitive together:
 *
 *   1. Resolve + load + validate the plan (Phase A).
 *   2. Open / migrate the state DB at <runDir>/state.db (Phase B).
 *   3. Create a run row + insert task rows.
 *   4. Spawn an opencode server (Phase D1) and bind a client + bus.
 *   5. Build a worktree pool + scheduler.
 *   6. Run the worker (Phase E).
 *   7. Mark the run terminal; print summary.
 *
 * Flags:
 *   --plan <path>        Override plan path (default: newest in plans dir).
 *   --filter <id>        Run only the named task (single id only in v0.1).
 *   --dry-run            Validate + print the plan summary; do not execute.
 *   --opencode-port <n>  Port for the spawned server (default: 0 = random).
 *   --workers <n>        v0.1 only honors 1; warns if >1 (clamps to 1).
 *
 * Exit codes:
 *   - 0: every task succeeded.
 *   - 1: I/O / wiring failure (couldn't load plan, couldn't start server).
 *   - 2: plan validation failure.
 *   - 3: at least one task failed (plan was valid + executed; some failed).
 *   - 130: user interrupt (SIGINT).
 */

import {
  command,
  flag,
  option,
  optional,
  positional,
  string,
  number as cmdNumber,
} from "cmd-ts";
import * as path from "node:path";

import { runValidate } from "./validate.js";
import { loadPlan } from "../plan/load.js";
import { validateDag } from "../plan/dag.js";
import { deriveSlug, resolveUniqueSlug } from "../plan/slug.js";
import {
  getPlansDir,
  getRunDir,
  getStateDbPath,
} from "../paths.js";
import { openStateDb } from "../state/db.js";
import {
  createRun,
  markRunRunning,
  markRunFinished,
} from "../state/runs.js";
import { upsertFromPlan, countByStatus, listTasks } from "../state/tasks.js";
import { appendEvent, subscribeToEvents, readEventsDecoded } from "../state/events.js";
import { startOpencodeServer } from "../opencode/server.js";
import { EventBus } from "../opencode/events.js";
import { makeScheduler } from "../scheduler/ready-set.js";
import { runWorker } from "../worker/worker.js";
import { promises as fs } from "node:fs";
import { requirePlugin } from "../../cli/plugin-check.js";
import type { Database } from "bun:sqlite";

// --- Public command --------------------------------------------------------

export const buildCmd = command({
  name: "build",
  description: "Execute a pilot.yaml plan via the worker loop.",
  args: {
    planPositional: positional({
      type: optional(string),
      displayName: "plan",
      description:
        "Plan path: absolute, cwd-relative, or bare filename (with or without .yaml/.yml) resolved against the pilot plans dir. Omit to pick interactively from the plans dir.",
    }),
    plan: option({
      long: "plan",
      type: optional(string),
      description:
        "Path to the plan file. Wins over the positional arg for backwards compatibility. Defaults to interactive picker; in non-TTY mode falls back to the newest *.yaml in the pilot plans dir.",
    }),
    filter: option({
      long: "filter",
      type: optional(string),
      description: "Run only this task id (v0.1: single id only).",
    }),
    dryRun: flag({
      long: "dry-run",
      description: "Validate the plan and print a summary; do not execute.",
    }),
    quiet: flag({
      long: "quiet",
      description:
        "Suppress per-task progress lines on stderr. Summary and error output still print.",
    }),
    opencodePort: option({
      long: "opencode-port",
      type: optional(cmdNumber),
      description: "Port for the spawned opencode server (default: 0 = random).",
    }),
    workers: option({
      long: "workers",
      type: optional(cmdNumber),
      description: "Worker count. v0.1 supports 1; >1 is clamped with a warning.",
    }),
  },
  handler: async (args) => {
    await requirePlugin();
    const code = await runBuild(args);
    process.exit(code);
  },
});

// --- Implementation --------------------------------------------------------

export async function runBuild(opts: {
  /** Positional plan arg: absolute, cwd-relative, or bare filename. */
  planPositional?: string | undefined;
  /** --plan flag: wins over the positional arg when both are supplied. */
  plan?: string | undefined;
  filter?: string | undefined;
  dryRun?: boolean;
  quiet?: boolean;
  opencodePort?: number | undefined;
  workers?: number | undefined;
  /**
   * Test seam. When no plan arg is provided and stdin is a TTY, we call
   * this to let the user pick a plan from the dir. Defaults to an
   * `@inquirer/prompts` `select()` listing plans sorted by mtime desc.
   * Returns the chosen absolute plan path, or `undefined` if the user
   * bailed (Ctrl-C).
   */
  readPlanSelection?: () => Promise<string | undefined>;
  /**
   * Test seam. Streaming progress lines are written via this function.
   * Defaults to `process.stderr.write`. Tests inject a stub to capture
   * output without polluting the test runner's stderr.
   */
  stderrWriter?: (chunk: string) => void;
}): Promise<number> {
  const cwd = process.cwd();
  const stderrWriter =
    opts.stderrWriter ?? ((s) => void process.stderr.write(s));

  // 1. Resolve the plan path BEFORE handing off to runValidate. Previously
  //    `runValidate` re-resolved, which meant a relative bare-filename
  //    like `rule-engine-refocus.yaml` was treated as cwd-relative and
  //    missed the plans dir entirely. We do the three-step resolution
  //    here and pass an absolute path downstream.
  const resolveResult = await resolvePlanPathSmart(
    {
      flag: opts.plan,
      positional: opts.planPositional,
    },
    cwd,
    opts.readPlanSelection,
  );
  if (resolveResult.kind === "cancelled") return 130;
  if (resolveResult.kind === "error") {
    process.stderr.write(`pilot build: ${resolveResult.message}\n`);
    return 2;
  }
  const resolvedPlanPath = resolveResult.path;

  // 2. Validate. Reuse runValidate so we get the same error rendering.
  const validateCode = await runValidate({
    planPath: resolvedPlanPath,
    quiet: true,
  });
  if (validateCode !== 0) return validateCode;

  // 3. Re-load (validate already opened it once; re-loading is cheap
  //    and lets us keep runValidate as a pure exit-code function).
  const planPath = resolvedPlanPath;
  const loaded = await loadPlan(planPath);
  if (!loaded.ok) {
    // Should be unreachable since runValidate just succeeded; defensive.
    process.stderr.write(`pilot build: load failed unexpectedly\n`);
    return 1;
  }
  const plan = loaded.plan;

  // 3. DAG (also validated above; we need the topo order here).
  const dag = validateDag(plan);
  if (!dag.ok) {
    process.stderr.write(`pilot build: DAG invalid (re-run pilot validate)\n`);
    return 2;
  }

  if (opts.workers !== undefined && opts.workers > 1) {
    process.stderr.write(
      `pilot build: --workers=${opts.workers} requested, but v0.1 supports 1; clamping.\n`,
    );
  }

  // Filter narrowing (v0.1: single id only).
  if (opts.filter !== undefined) {
    if (!plan.tasks.find((t) => t.id === opts.filter)) {
      process.stderr.write(
        `pilot build: --filter ${JSON.stringify(opts.filter)} doesn't match any task in the plan\n`,
      );
      return 2;
    }
  }

  if (opts.dryRun) {
    printDryRun(plan, planPath);
    return 0;
  }

  // 4. Derive run-id + slug + dirs.
  const slug = await deriveUniqueSlug(plan, planPath, cwd);

  // 5. Open state DB.
  const opened = openStateDb(":memory:"); // placeholder; reassigned below
  opened.close();
  const cleanup: Array<() => Promise<void> | void> = [];

  // We can't compute the runId before createRun (that's the source of
  // truth for ULID generation). Open a temporary in-memory DB just to
  // call createRun? No — createRun expects the same DB to persist. Do
  // it in two phases: pre-allocate a dir using a placeholder, then
  // move once we know the id. Simpler approach: open a tmp DB just to
  // generate the ULID via createRun's internal call, then move the
  // file? Cleaner: refactor createRun to accept a pre-generated id.
  //
  // For v0.1, the simplest correct flow: use ULID generation directly.
  const { ulid } = await import("ulid");
  const runId = ulid();
  const dbPath = await getStateDbPath(cwd, runId);
  const runDir = await getRunDir(cwd, runId);

  // Branch prefix MUST include the runId so that two runs of the same
  // plan don't collide on `git worktree add -B`. Prior runs with preserved
  // worktrees hold `<basePrefix>/<oldRunId>/<taskId>` branches; new runs
  // get `<basePrefix>/<newRunId>/<taskId>`. `pilot resume` reconstructs
  // the same prefix using the persisted run_id.
  const branchPrefix = deriveBranchPrefix(plan.branch_prefix, slug, runId);

  const real = openStateDb(dbPath);
  cleanup.push(() => real.close());

  // Since we generated the runId externally, we manually insert the
  // run row to mirror createRun's effect.
  real.db.run(
    `INSERT INTO runs (id, plan_path, plan_slug, started_at, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [runId, planPath, slug, Date.now()],
  );
  // (Keep the import to satisfy "unused import" lint cleanliness when
  // we eventually refactor.)
  void createRun;

  upsertFromPlan(real.db, runId, plan);
  markRunRunning(real.db, runId);
  appendEvent(real.db, {
    runId,
    kind: "run.started",
    payload: { planPath, slug, runDir, branchPrefix },
  });

  // From here on, the per-run execution is shared with `pilot resume`.
  // Run the setup hook BEFORE handing to executeRun (which spawns the
  // opencode server + worker). The hook makes the dev stack ready.
  const { runSetupHook, SETUP_HOOK_RELATIVE_PATH } = await import(
    "../worker/setup-hook.js"
  );
  const hookResult = await runSetupHook({
    cwd,
    onLine: (c) => stderrWriter(c),
  });
  switch (hookResult.kind) {
    case "skipped":
      break;
    case "ok":
      stderrWriter(
        `[pilot] setup hook ${SETUP_HOOK_RELATIVE_PATH} passed (${Math.round(hookResult.durationMs / 1000)}s)\n`,
      );
      break;
    case "not-executable":
      stderrWriter(
        `[pilot] setup hook ${hookResult.hookPath} is not executable. ` +
          `Run \`chmod +x ${SETUP_HOOK_RELATIVE_PATH}\` and re-run pilot.\n`,
      );
      await runCleanup(cleanup);
      return 1;
    case "timed-out":
      stderrWriter(
        `[pilot] setup hook ${hookResult.hookPath} timed out after ${Math.round(hookResult.timeoutMs / 1000)}s\n`,
      );
      await runCleanup(cleanup);
      return 1;
    case "failed":
      stderrWriter(
        `[pilot] setup hook ${hookResult.hookPath} exited ${hookResult.exitCode} ` +
          `(after ${Math.round(hookResult.durationMs / 1000)}s). ` +
          `Fix the environment and re-run pilot.\n`,
      );
      await runCleanup(cleanup);
      return 1;
    case "spawn-error":
      stderrWriter(
        `[pilot] setup hook ${hookResult.hookPath} failed to spawn: ${hookResult.error}\n`,
      );
      await runCleanup(cleanup);
      return 1;
  }

  return executeRun({
    db: real,
    runId,
    plan,
    planPath,
    runDir,
    branchPrefix,
    cleanup,
    opencodePort: opts.opencodePort,
    quiet: opts.quiet,
    stderrWriter,
  });
}

/**
 * Execute the worker against an already-prepared run row + state DB.
 *
 * Extracted from `runBuild` so `pilot resume` can re-enter the
 * post-validation lifecycle without re-creating a run row. Caller is
 * responsible for:
 *
 *   - Validating the plan (no-op on resume; the plan was validated at
 *     build time).
 *   - Inserting the `runs` row + task rows (build creates fresh; resume
 *     leaves existing rows alone).
 *   - Setting up the `cleanup` array (caller pushes whatever needs to
 *     run on exit).
 *
 * Returns the appropriate exit code: 0 = clean, 3 = some failures,
 * 130 = aborted, 1 = wiring failure.
 */
export async function executeRun(args: {
  db: ReturnType<typeof openStateDb>;
  runId: string;
  plan: ReturnType<typeof loadPlan> extends Promise<infer R>
    ? R extends { ok: true; plan: infer P }
      ? P
      : never
    : never;
  planPath: string;
  runDir: string;
  branchPrefix: string;
  cleanup: Array<() => Promise<void> | void>;
  opencodePort?: number | undefined;
  /** Suppress per-task streaming output on stderr. Summary still prints. */
  quiet?: boolean;
  /** Sink for streaming log lines. Defaults to `process.stderr.write`. */
  stderrWriter?: (chunk: string) => void;
}): Promise<number> {
  const { db, runId, plan, planPath, runDir, branchPrefix, cleanup } = args;
  const cwd = process.cwd();
  const stderrWriter =
    args.stderrWriter ?? ((s: string) => void process.stderr.write(s));

  // 6. Spawn server.
  // Resolve paths for MCP status server injection
  const runDirForMcp = await getRunDir(cwd, runId);
  const dbPathForMcp = await getStateDbPath(cwd, runId);

  let server;
  try {
    server = await startOpencodeServer({
      port: args.opencodePort ?? 0,
      runContext: {
        runDir: runDirForMcp,
        dbPath: dbPathForMcp,
        runId,
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    appendEvent(db.db, {
      runId,
      kind: "run.error",
      payload: { phase: "server-start", reason },
    });
    markRunFinished(db.db, runId, "failed");
    process.stderr.write(`pilot: ${reason}\n`);
    await runCleanup(cleanup);
    return 1;
  }
  cleanup.push(() => server!.shutdown());

  // Bus factory: each task gets its own EventBus scoped to the task's
  // worktree directory. opencode's SSE `/event` endpoint filters
  // session-level events by subscriber directory (exact-match), so
  // a single bus at run start would receive only server-wide events
  // (heartbeats, file-watcher) and never session events
  // (message.updated, message.part.updated, session.idle). Every pilot
  // task stalling-at-5min through v0.16.1 traces to this bug.
  // Worker's runOneTask invokes this factory after creating the task's
  // worktree and closes the bus at task teardown.
  const busFactory = (directory: string) =>
    new EventBus(server!.client, directory);

  // 7. Build scheduler.
  const scheduler = makeScheduler({ db: db.db, runId, plan });

  // 8. No base ref needed in cwd mode — worker captures sinceSha per task.

  // 9. Run the worker.
  const aborter = new AbortController();
  const sigintHandler = () => aborter.abort("SIGINT");
  process.once("SIGINT", sigintHandler);
  cleanup.push(() => {
    process.off("SIGINT", sigintHandler);
  });

  // Streaming progress logger — subscribes to appendEvent fan-out and
  // writes per-task lines to stderr as events are persisted. Suppressed
  // under --quiet. Teardown runs before DB close; we push it to cleanup
  // so SIGINT paths also clean up the subscription.
  if (args.quiet !== true) {
    // Write the banner BEFORE subscribing to events — prevents the
    // first task.started event from interleaving with the banner line.
    stderrWriter(
      `pilot build: run ${runId} started (${plan.tasks.length} tasks)\n`,
    );
    const unsubLogger = startStreamingLogger({
      stderrWriter,
      runId,
      totalTasks: plan.tasks.length,
      subscribe: subscribeToEvents,
      db: db.db,
    });
    cleanup.push(() => unsubLogger());
  }

  const result = await runWorker({
    db: db.db,
    runId,
    plan,
    scheduler,
    client: server.client,
    busFactory,
    abortSignal: aborter.signal,
  });

  // 10. Compute final disposition.
  const counts = countByStatus(db.db, runId);
  const finalStatus = result.aborted
    ? "aborted"
    : counts.failed > 0 || counts.aborted > 0 || counts.blocked > 0
      ? "failed"
      : "completed";
  markRunFinished(db.db, runId, finalStatus);
  appendEvent(db.db, {
    runId,
    kind: "run.finished",
    payload: { status: finalStatus, counts },
  });

  // 11. Print summary BEFORE cleanup so subprocess shutdown noise
  //     doesn't interleave with the user-facing report.
  printSummary({ planPath, runId, runDir, counts, finalStatus, db: db.db });

  // 12. Cleanup (server, bus, pool, sigint handler, db).
  await runCleanup(cleanup);

  if (result.aborted) return 130;
  if (counts.failed > 0 || counts.aborted > 0 || counts.blocked > 0) return 3;
  return 0;
}

// --- Helpers ---------------------------------------------------------------

/**
 * Three-step plan-path resolver. Replaces the v0.1 resolver, which only
 * handled `path.resolve(input)` (and therefore failed on bare filenames
 * that live in the plans dir — forcing users to type the full
 * `~/.glorious/opencode/<repo>/pilot/plans/<file>.yaml` every time).
 *
 * Resolution order:
 *   1. `--plan <path>` flag (preserved for backwards compatibility and
 *      script pinning). Treated as an explicit absolute-or-cwd-relative
 *      path; no fallback search.
 *   2. Positional plan arg. Tried as: (a) absolute path, (b) cwd-relative,
 *      (c) plans-dir-relative, (d) plans-dir-relative with `.yaml` appended,
 *      (e) plans-dir-relative with `.yml` appended. First hit wins.
 *   3. Interactive picker via `readPlanSelection()` when stdin is a TTY.
 *   4. Fallback to the newest *.yaml in the plans dir (old default).
 *
 * Returns a discriminated result so callers can distinguish "user Ctrl-C'd
 * out of the picker" (exit 130) from "no plan could be resolved" (exit 2)
 * from a successful resolution.
 */
type ResolveResult =
  | { kind: "ok"; path: string }
  | { kind: "cancelled" } // user hit Ctrl-C in the picker
  | { kind: "error"; message: string };

async function resolvePlanPathSmart(
  input: { flag?: string | undefined; positional?: string | undefined },
  cwd: string,
  readPlanSelection?: () => Promise<string | undefined>,
): Promise<ResolveResult> {
  // 1. --plan flag — explicit, wins over positional.
  if (input.flag !== undefined && input.flag.length > 0) {
    const resolved = path.isAbsolute(input.flag)
      ? input.flag
      : path.resolve(cwd, input.flag);
    if (await isFile(resolved)) {
      return { kind: "ok", path: resolved };
    }
    return {
      kind: "error",
      message: `cannot find plan at ${JSON.stringify(resolved)} (from --plan ${JSON.stringify(input.flag)})`,
    };
  }

  // 2. Positional arg — three-step resolution.
  if (input.positional !== undefined && input.positional.length > 0) {
    const plansDir = await getPlansDir(cwd);
    const candidates: string[] = [];
    if (path.isAbsolute(input.positional)) {
      candidates.push(input.positional);
    } else {
      candidates.push(path.resolve(cwd, input.positional));
      candidates.push(path.join(plansDir, input.positional));
      if (!/\.(ya?ml)$/i.test(input.positional)) {
        candidates.push(path.join(plansDir, `${input.positional}.yaml`));
        candidates.push(path.join(plansDir, `${input.positional}.yml`));
      }
    }
    for (const c of candidates) {
      if (await isFile(c)) return { kind: "ok", path: c };
    }
    return {
      kind: "error",
      message:
        `cannot find plan ${JSON.stringify(input.positional)}. Tried:\n` +
        candidates.map((c) => `  - ${c}`).join("\n"),
    };
  }

  // 3. Interactive picker — only when stdin is a TTY AND a reader is
  //    available (either the default inquirer picker or a test stub).
  //    A caller that explicitly passes `readPlanSelection: undefined`
  //    AND no args is asking for the non-interactive fallback path,
  //    which we handle in step 4.
  if (process.stdin.isTTY && readPlanSelection !== undefined) {
    const picked = await readPlanSelection();
    if (picked === undefined) return { kind: "cancelled" };
    return { kind: "ok", path: picked };
  }
  if (process.stdin.isTTY && readPlanSelection === undefined) {
    // Production default: fall back to the inquirer-backed picker when
    // the caller didn't override. Tests that want non-interactive
    // fallback should pass `readPlanSelection: () => Promise.resolve(undefined)`
    // or just use the --plan flag / positional.
    const picked = await defaultReadPlanSelection(cwd);
    if (picked === undefined) return { kind: "cancelled" };
    return { kind: "ok", path: picked };
  }

  // 4. Non-TTY fallback: newest *.yaml in the plans dir. Same behavior
  //    as the v0.1 default; preserved so scripts piping into `pilot build`
  //    with no args keep working.
  const plansDir = await getPlansDir(cwd);
  const newest = await findNewestYaml(plansDir);
  if (newest === null) {
    return {
      kind: "error",
      message: `no *.yaml files in ${plansDir}`,
    };
  }
  return { kind: "ok", path: newest };
}

async function isFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function findNewestYaml(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const yamls = entries.filter(
    (n) => n.endsWith(".yaml") || n.endsWith(".yml"),
  );
  if (yamls.length === 0) return null;
  let newest: { name: string; mtime: number } | null = null;
  for (const name of yamls) {
    try {
      const st = await fs.stat(path.join(dir, name));
      if (newest === null || st.mtimeMs > newest.mtime) {
        newest = { name, mtime: st.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return newest ? path.join(dir, newest.name) : null;
}

/**
 * Default interactive plan picker. Dynamic-imports `@inquirer/prompts`
 * so the dep is only loaded when `pilot build` is invoked interactively
 * with no plan arg. Matches the pattern used in `pilot plan` for the
 * free-text prompt.
 *
 * Returns the chosen absolute plan path, or `undefined` if the user hit
 * Ctrl-C (inquirer throws `ExitPromptError`).
 */
async function defaultReadPlanSelection(
  cwd: string,
): Promise<string | undefined> {
  const plansDir = await getPlansDir(cwd);
  let entries: string[];
  try {
    entries = await fs.readdir(plansDir);
  } catch {
    return undefined;
  }
  const yamls = entries.filter(
    (n) => n.endsWith(".yaml") || n.endsWith(".yml"),
  );
  if (yamls.length === 0) return undefined;

  // Stat in parallel to sort by mtime desc.
  const stats = await Promise.all(
    yamls.map(async (name) => {
      const full = path.join(plansDir, name);
      try {
        const st = await fs.stat(full);
        return { name, full, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const sorted = stats
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.mtime - a.mtime);

  // Best-effort plan-name enrichment. If loadPlan succeeds, show the
  // `name:` field alongside the filename. If it fails (invalid YAML,
  // schema errors, etc.), just show the filename — a broken plan still
  // belongs in the picker list so the user can discover it.
  const annotated = await Promise.all(
    sorted.map(async (s) => {
      try {
        const loaded = await loadPlan(s.full);
        const planName = loaded.ok ? loaded.plan.name : null;
        return { ...s, planName };
      } catch {
        return { ...s, planName: null };
      }
    }),
  );

  const choices = annotated.map((a) => ({
    name: formatPickerRow(a.name, a.planName, a.mtime),
    value: a.full,
  }));

  const { select } = await import("@inquirer/prompts");
  try {
    const chosen = await select({
      message: "Pick a plan:",
      choices,
    });
    return chosen;
  } catch (err) {
    if (isExitPromptError(err)) return undefined;
    throw err;
  }
}

function formatPickerRow(
  filename: string,
  planName: string | null,
  mtimeMs: number,
): string {
  const rel = relativeTimeFromNow(mtimeMs);
  if (planName === null) return `${filename}  —  ${rel}`;
  return `${filename}  —  ${planName}  —  ${rel}`;
}

function relativeTimeFromNow(thenMs: number): string {
  const deltaMs = Date.now() - thenMs;
  const s = Math.max(0, Math.round(deltaMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/**
 * Format a duration in ms as a human-readable string.
 *   < 60s  → "42s"
 *   ≥ 60s  → "Xm Ys" (rounded to the nearest second)
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function isExitPromptError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: unknown }).name === "ExitPromptError"
  );
}

/**
 * Start a streaming logger that writes per-task progress lines to
 * `stderrWriter` as events are appended to the DB. Returns an
 * unsubscribe function that teardown should call in all paths
 * (normal completion, SIGINT, error).
 *
 * The logger subscribes to the global `appendEvent` fan-out (added in
 * `src/pilot/state/events.ts`). Subscribing there instead of the
 * EventBus keeps us at the semantic layer (task-level events already
 * computed by the worker) rather than the raw opencode SSE stream.
 *
 * Output is deliberately compact — one line per high-signal event, not
 * every event kind. Users who need the full trace can `pilot logs --run`.
 */
export function startStreamingLogger(args: {
  stderrWriter: (chunk: string) => void;
  runId: string;
  totalTasks: number;
  subscribe: typeof import("../state/events.js").subscribeToEvents;
  clock?: () => number;
  /**
   * Optional: the state DB instance. When provided, the logger polls for
   * `task.progress` events written by the MCP subprocess (which can't
   * trigger the in-process fan-out). Without this, progress events from
   * the MCP server won't appear in the streaming log.
   */
  db?: import("bun:sqlite").Database;
  /** Polling interval for MCP-written progress events. Default 2000ms. */
  progressPollMs?: number;
}): () => void {
  const { stderrWriter, runId, totalTasks, subscribe } = args;
  const clock = args.clock ?? (() => Date.now());
  const taskStart = new Map<string, number>();
  let succeeded = 0;
  let failed = 0;
  // Blocked-cascade: render the first INLINE_BLOCKED_CAP events inline as
  // they arrive; collapse any beyond the cap into a single "...N more"
  // continuation. The end-of-run summary (flushBlockedSummary) still fires
  // with the total count + first-reason, which remains useful at high
  // cascade counts.
  const INLINE_BLOCKED_CAP = 5;
  let blockedCount = 0;
  let blockedInlineEmitted = 0;
  let blockedOverflowEmitted = false;
  let blockedReason: string | null = null;
  let blockedFlushed = false;

  const formatTs = (ms: number): string => {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  };

  const write = (line: string) => {
    // Atomic single-call write — prevents interleaving when multiple
    // event handlers fire in the same tick. process.stderr.write with
    // a complete string (including \n) is guaranteed to be written as
    // one chunk on POSIX (up to PIPE_BUF = 4096 bytes).
    const msg = `[${formatTs(clock())}] ${line}\n`;
    stderrWriter(msg);
  };

  const writeRaw = (line: string) => {
    stderrWriter(`${line}\n`);
  };

  const flushBlockedSummary = () => {
    if (blockedFlushed) return;
    blockedFlushed = true;
    if (blockedCount === 0) return;
    const suffix = blockedReason !== null ? ` (${blockedReason})` : "";
    write(
      `blocked: ${blockedCount} task(s) waiting on failed dependency${suffix}`,
    );
  };

  const unsub = subscribe((event) => {
    // Scope to this run only; in practice there's only one active run
    // per `pilot build` process, but filter defensively in case other
    // runs concurrently insert (pilot plan, other subsystems).
    if (event.runId !== runId) return;

    const id = event.taskId;
    switch (event.kind) {
      case "task.started":
        if (id !== null) taskStart.set(id, event.ts);
        write(`task.started ${id ?? "?"}`);
        break;
      case "task.verify.passed":
        write(`task.verify.passed ${id ?? "?"}`);
        break;
      case "task.verify.failed": {
        // Render richer line when payload is conforming; fall back to
        // terse one-liner for non-conforming (pre-v0.2) payloads.
        const p = event.payload as {
          attempt?: unknown;
          of?: unknown;
          command?: unknown;
          exitCode?: unknown;
          timedOut?: unknown;
        } | null;
        if (
          p !== null &&
          typeof p === "object" &&
          typeof p.attempt === "number" &&
          typeof p.of === "number" &&
          typeof p.command === "string" &&
          typeof p.exitCode === "number"
        ) {
          const timedOutSuffix = p.timedOut === true ? " (timed out)" : "";
          write(
            `task.verify.failed ${id ?? "?"} attempt ${p.attempt}/${p.of} (${p.command} → exit ${p.exitCode}${timedOutSuffix})`,
          );
          // Show the tail of the output so the user can see what failed
          // without opening the full logs.
          const output = typeof (p as { output?: unknown }).output === "string"
            ? ((p as { output: string }).output)
            : null;
          if (output !== null && output.length > 0) {
            const tail = output.trim().split("\n").slice(-3).map((l) => `    ${l}`).join("\n");
            writeRaw(tail);
          }
        } else {
          write(`task.verify.failed ${id ?? "?"}`);
        }
        break;
      }
      case "task.succeeded": {
        succeeded += 1;
        const ms = id !== null ? event.ts - (taskStart.get(id) ?? event.ts) : 0;
        write(`task.succeeded ${id ?? "?"} in ${formatDuration(ms)}`);
        write(`run.progress ${succeeded}/${totalTasks} succeeded`);
        break;
      }
      case "task.failed": {
        failed += 1;
        const ms = id !== null ? event.ts - (taskStart.get(id) ?? event.ts) : 0;
        write(`task.failed ${id ?? "?"} in ${formatDuration(ms)}`);
        // Render phase+reason continuation if the worker populated
        // them (post-v0.2 task.failed payload). Tolerate missing
        // fields — events from pre-v0.2 code paths may not have them.
        const detail = extractPhaseReason(event.payload);
        if (detail !== null) {
          writeRaw(`  → ${detail.phase}: ${truncate(detail.reason, 200)}`);
        }
        write(
          `run.progress ${succeeded}/${totalTasks} succeeded, ${failed} failed`,
        );
        // Always emit a logs-pointer breadcrumb so the user can find
        // the full event trace without waiting for the end-of-run summary.
        if (id !== null) {
          writeRaw(
            `  run \`bunx @glrs-dev/harness-plugin-opencode pilot logs ${id} --run ${runId}\` for full logs`,
          );
        }
        break;
      }
      case "task.aborted":
        write(`task.aborted ${id ?? "?"}`);
        break;
      case "task.stopped": {
        // Render stopReason inline when payload carries it; fall back to
        // the generic "(builder STOP)" suffix otherwise.
        const p = event.payload as { reason?: unknown } | null;
        const stopReason =
          p !== null && typeof p === "object" && typeof p.reason === "string"
            ? p.reason
            : null;
        const suffix = stopReason !== null ? `(${stopReason})` : "(builder STOP)";
        write(`task.stopped ${id ?? "?"} ${suffix}`);
        // Logs-pointer breadcrumb — same as task.failed.
        if (id !== null) {
          writeRaw(
            `  run \`bunx @glrs-dev/harness-plugin-opencode pilot logs ${id} --run ${runId}\` for full logs`,
          );
        }
        break;
      }
      case "task.blocked": {
        // Count every blocked event for the end-of-run summary.
        blockedCount += 1;
        if (blockedReason === null) {
          const p = event.payload as { reason?: unknown } | null;
          if (
            p !== null &&
            typeof p === "object" &&
            typeof p.reason === "string"
          ) {
            blockedReason = p.reason;
          }
        }
        // Render inline up to the cap.
        if (blockedInlineEmitted < INLINE_BLOCKED_CAP) {
          blockedInlineEmitted += 1;
          const p = event.payload as { failedDep?: unknown } | null;
          const failedDep =
            p !== null &&
            typeof p === "object" &&
            typeof p.failedDep === "string"
              ? p.failedDep
              : null;
          const depSuffix =
            failedDep !== null
              ? `(blocked by failed task ${failedDep})`
              : "(dep failed)";
          write(`task.blocked ${id ?? "?"} ${depSuffix}`);
        } else if (!blockedOverflowEmitted) {
          // First event past the cap: emit a single collapse line.
          // The count of "more" events is blockedCount - INLINE_BLOCKED_CAP.
          blockedOverflowEmitted = true;
          const moreCount = blockedCount - INLINE_BLOCKED_CAP;
          writeRaw(`  ...${moreCount} more blocked (see run summary)`);
        } else {
          // Subsequent overflow events: update the collapse line count.
          // We can't rewrite the already-emitted line, so we just keep
          // counting — the end-of-run summary will show the full total.
        }
        break;
      }
      case "task.attempt": {
        // Render a low-key continuation line for attempt >= 2 (retry with
        // fix prompt). Attempt 1 stays suppressed — first attempts are the
        // default and don't need a tick.
        const p = event.payload as { attempt?: unknown; of?: unknown } | null;
        if (
          p !== null &&
          typeof p === "object" &&
          typeof p.attempt === "number" &&
          typeof p.of === "number" &&
          p.attempt >= 2
        ) {
          writeRaw(`  attempt ${p.attempt}/${p.of} (retry with fix prompt)`);
        }
        // attempt === 1 or non-conforming payload: stay suppressed.
        break;
      }
      case "run.finished":
        flushBlockedSummary();
        break;
      case "task.touches.violation":
        write(`task.touches.violation ${id ?? "?"}`);
        break;
      case "task.progress": {
        // Format: [HH:MM:SS] <taskId> > <message>
        const p = event.payload as { message?: string } | null;
        const message = p?.message ?? "(no message)";
        write(`${id ?? "?"} > ${message}`);
        break;
      }
      // Other kinds (task.session.created, run.*) are intentionally
      // suppressed — too chatty for stdout. `pilot logs` carries the
      // full trace.
      default:
        break;
    }
  });

  // Poll the DB for task.progress events written by the MCP subprocess.
  // The MCP server is a separate process that writes directly to SQLite;
  // it can't trigger the in-process appendEvent fan-out. This poller
  // bridges that gap by reading new progress events and rendering them.
  let progressPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastProgressId = 0;
  if (args.db) {
    const pollDb = args.db;
    const pollMs = args.progressPollMs ?? 2000;
    // Seed lastProgressId to the current max so we don't replay old events.
    try {
      const row = pollDb
        .query(
          `SELECT MAX(id) as maxId FROM events WHERE run_id=? AND kind='task.progress'`,
        )
        .get(runId) as { maxId: number | null } | null;
      lastProgressId = row?.maxId ?? 0;
    } catch {
      // Table may not exist yet or be empty — start from 0.
    }
    progressPollTimer = setInterval(() => {
      try {
        const rows = pollDb
          .query(
            `SELECT id, task_id, ts, payload FROM events WHERE run_id=? AND kind='task.progress' AND id > ? ORDER BY id`,
          )
          .all(runId, lastProgressId) as Array<{
          id: number;
          task_id: string | null;
          ts: number;
          payload: string;
        }>;
        for (const row of rows) {
          lastProgressId = row.id;
          try {
            const p = JSON.parse(row.payload) as { message?: string };
            const message = p?.message ?? "(no message)";
            write(`${row.task_id ?? "?"} > ${message}`);
          } catch {
            // Malformed payload — skip.
          }
        }
      } catch {
        // DB read failure — swallow; next poll will retry.
      }
    }, pollMs);
  }

  return () => {
    // Flush blocked summary on teardown too, in case run.finished
    // never fired (SIGINT, server crash, etc.) — the user should
    // still see the count on their way out.
    flushBlockedSummary();
    if (progressPollTimer) clearInterval(progressPollTimer);
    unsub();
  };
}

/**
 * Extract `{phase, reason}` from a task.failed event payload, tolerating
 * payloads that predate v0.2's enrichment (no phase/reason fields) or
 * aren't objects at all. Returns null when either field is missing or
 * non-string; the streaming logger + summary both use that as a signal
 * to skip the continuation line.
 */
function extractPhaseReason(
  payload: unknown,
): { phase: string; reason: string } | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as { phase?: unknown; reason?: unknown };
  if (typeof p.phase !== "string" || typeof p.reason !== "string") {
    return null;
  }
  return { phase: p.phase, reason: p.reason };
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + "…";
}

/**
 * Construct the branch prefix used for per-task worktrees. Format is
 * `<basePrefix>/<runId>` where `<basePrefix>` is either the user's
 * `plan.branch_prefix` override or the default `pilot/<slug>`.
 *
 * The runId segment is what makes branches collision-free across runs
 * of the same plan. Without it, `preserveOnFailure` worktrees from a
 * prior run hold branches with the same name, and `git worktree add -B`
 * refuses to re-bind them. With it, each run's branches live in their
 * own ULID-scoped namespace.
 *
 * Exported so tests can lock the shape.
 */
export function deriveBranchPrefix(
  planBranchPrefix: string | undefined,
  slug: string,
  runId: string,
): string {
  const base = planBranchPrefix ?? `pilot/${slug}`;
  return `${base}/${runId}`;
}

async function deriveUniqueSlug(
  plan: { name: string },
  planPath: string,
  cwd: string,
): Promise<string> {
  // Use the plan filename basename (sans extension) as the source of
  // truth — the planner agent already deterministically slugged the
  // input when saving. Fallback to plan.name → kebab if needed.
  const base =
    path.basename(planPath, path.extname(planPath)) ||
    deriveSlug(plan.name);

  const dir = await getPlansDir(cwd);
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const existingSlugs = new Set(
    entries
      .filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"))
      .map((n) => path.basename(n, path.extname(n))),
  );
  // The plan we're building IS in the dir; that's not a "collision".
  existingSlugs.delete(base);
  return resolveUniqueSlug(base, existingSlugs);
}

function printDryRun(
  plan: { name: string; tasks: ReadonlyArray<{ id: string; title: string }> },
  planPath: string,
): void {
  process.stdout.write(
    `# pilot build --dry-run\nPlan: ${plan.name} (${planPath})\nTasks:\n`,
  );
  for (const t of plan.tasks) {
    process.stdout.write(`  - ${t.id}: ${t.title}\n`);
  }
}

export function printSummary(args: {
  planPath: string;
  runId: string;
  runDir: string;
  counts: ReturnType<typeof countByStatus>;
  finalStatus: string;
  db: Database;
}): void {
  const { counts, finalStatus, runId, runDir, planPath, db } = args;
  const totalRun = counts.succeeded + counts.failed + counts.aborted;

  // Counts line first (identical to pre-v0.2 for back-compat).
  process.stdout.write(
    `\nRun ${runId} ${finalStatus}: ` +
      `succeeded=${counts.succeeded} failed=${counts.failed} ` +
      `blocked=${counts.blocked} aborted=${counts.aborted} ` +
      `pending=${counts.pending} ready=${counts.ready} running=${counts.running} ` +
      `(of ${totalRun + counts.blocked + counts.pending + counts.ready + counts.running} total)\n`,
  );

  // Failure block — only when there's something to show. Runs with
  // zero failed + zero aborted render exactly as before.
  if (counts.failed > 0 || counts.aborted > 0) {
    const failed = listTasks(db, runId).filter(
      (t) => t.status === "failed" || t.status === "aborted",
    );
    if (failed.length > 0) {
      process.stdout.write(`\nFailed tasks (${failed.length}):\n\n`);
      for (const t of failed) {
        const { phase, reason } = resolveFailureDetail(db, runId, t);
        const session = t.session_id ?? "(none — failed before session.create)";
        const worktree = t.worktree_path ?? "(none)";
        const elapsed =
          t.started_at !== null && t.finished_at !== null
            ? formatDuration(t.finished_at - t.started_at)
            : "0s";
        process.stdout.write(
          `  ${t.task_id}\n` +
            `    phase:    ${phase}\n` +
            `    reason:   ${truncateSummary(reason, 300)}\n` +
            `    session:  ${session}\n` +
            `    worktree: ${worktree}\n` +
            `    elapsed:  ${elapsed}   attempts: ${t.attempts}\n` +
            `\n`,
        );
      }
    }
  }

  // Follow-up commands last (unchanged).
  process.stdout.write(
    `  plan: ${planPath}\n` +
      `  run dir: ${runDir}\n` +
      `  status: bunx @glrs-dev/harness-plugin-opencode pilot status --run ${runId}\n` +
      `  logs:   bunx @glrs-dev/harness-plugin-opencode pilot logs --run ${runId} <task-id>\n`,
  );
}

/**
 * Resolve the `{phase, reason}` to print for a failed/aborted task.
 *
 * Priority:
 *   1. Last `task.failed` event's payload.phase + payload.reason (post-v0.2).
 *   2. Row's `last_error` fallback for reason; phase defaults to "unknown".
 *   3. `"(no reason recorded)"` placeholder when both are empty.
 */
function resolveFailureDetail(
  db: Database,
  runId: string,
  row: { task_id: string; last_error: string | null },
): { phase: string; reason: string } {
  const events = readEventsDecoded(db, { runId, taskId: row.task_id });
  // Walk in reverse for the latest task.failed event.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "task.failed") continue;
    const p = e.payload as { phase?: unknown; reason?: unknown } | null;
    if (p !== null && typeof p === "object") {
      const phase = typeof p.phase === "string" ? p.phase : "unknown";
      const reason =
        typeof p.reason === "string"
          ? p.reason
          : row.last_error ?? "(no reason recorded)";
      return { phase, reason };
    }
  }
  return {
    phase: "unknown",
    reason: row.last_error ?? "(no reason recorded)",
  };
}

function truncateSummary(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1) + "…";
}

async function runCleanup(
  cleanup: Array<() => Promise<void> | void>,
): Promise<void> {
  // Run in reverse insertion order so dependencies tear down before the
  // things they depended on (e.g. bus.close before server.shutdown).
  while (cleanup.length > 0) {
    const fn = cleanup.pop()!;
    try {
      await fn();
    } catch {
      // Swallow cleanup errors — by definition we're already shutting
      // down; a noisy stack trace doesn't help the user understand
      // the actual run outcome.
    }
  }
}
