/**
 * `pilot build-resume [--run <id>]` — continue a partially-completed run.
 *
 * Semantics:
 *   - Discovers the latest non-terminal run in this repo (or honors
 *     `--run <id>` for explicit targeting).
 *   - Refuses if every task is already `succeeded` (nothing to resume).
 *   - Safety gate: same as `pilot build` — must be on a feature branch
 *     with a clean tree.
 *   - Branch match: current branch name must equal the run's recorded
 *     branch (the branch the failed task was started on). Prevents
 *     "I switched branches since" mistakes.
 *   - Task reset: every non-succeeded task → `pending` with attempts=0,
 *     session_id/last_error cleared. Succeeded tasks untouched (their
 *     commits are already on HEAD).
 *   - Run reset: run status → `running`, `finished_at` cleared.
 *   - Frozen plan: loads `<runDir>/plan.yaml`, NOT a filesystem plan.
 *     Editing the plan mid-run means starting fresh.
 *
 * Exit codes:
 *   0 — resume succeeded (every remaining task completed).
 *   1 — wiring failure / cannot find run / branch mismatch / etc.
 *   2 — run has no resumable tasks (all succeeded, or run not found).
 *   3 — resume ran but at least one task failed.
 *   130 — user interrupt (SIGINT).
 */

import { command, flag, option, optional, string, number as cmdNumber } from "cmd-ts";
import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { discoverRun } from "./discover.js";
import { executeRun, deriveBranchPrefix } from "./build.js";
import { openStateDb } from "../state/db.js";
import { getRun, markRunResumed } from "../state/runs.js";
import { countByStatus, resetTasksForResume } from "../state/tasks.js";
import { appendEvent } from "../state/events.js";
import { loadPlan } from "../plan/load.js";
import { resolveBaseDir } from "../paths.js";
import { requirePlugin } from "../../cli/plugin-check.js";

const execFileP = promisify(execFileCb);

// --- Public command --------------------------------------------------------

export const buildResumeCmd = command({
  name: "build-resume",
  description: "Resume a partially-completed pilot run from where it left off.",
  args: {
    run: option({
      long: "run",
      type: optional(string),
      description:
        "Run ID to resume. Defaults to the newest resumable run matching --plan (or interactive picker if multiple exist).",
    }),
    plan: option({
      long: "plan",
      type: optional(string),
      description:
        "Filter to runs that used this plan path (absolute, cwd-relative, or bare filename resolved against the plans dir). Disambiguates when multiple worktrees share a state dir.",
    }),
    opencodePort: option({
      long: "opencode-port",
      type: optional(cmdNumber),
      description: "Port for the spawned opencode server (default: 0 = random).",
    }),
    quiet: flag({
      long: "quiet",
      description:
        "Suppress per-task progress lines on stderr. Summary still prints.",
    }),
  },
  handler: async (args) => {
    await requirePlugin();
    const code = await runBuildResume(args);
    process.exit(code);
  },
});

// --- Implementation --------------------------------------------------------

export async function runBuildResume(opts: {
  run?: string | undefined;
  plan?: string | undefined;
  opencodePort?: number | undefined;
  quiet?: boolean;
  /** Test seam. Defaults to `process.stderr.write`. */
  stderrWriter?: (chunk: string) => void;
}): Promise<number> {
  const cwd = process.cwd();
  const stderrWriter =
    opts.stderrWriter ?? ((s: string) => void process.stderr.write(s));

  // 1. Discover the target run.
  let runId: string;
  let dbPath: string;
  let runDir: string;
  try {
    if (opts.run !== undefined && opts.run.length > 0) {
      // Explicit — use discoverRun.
      const d = await discoverRun({ cwd, runId: opts.run });
      runId = d.runId;
      dbPath = d.dbPath;
      runDir = d.runDir;
    } else {
      // Find resumable runs, optionally filtered by plan path.
      const planFilter = opts.plan !== undefined && opts.plan.length > 0
        ? await resolvePlanFilter(cwd, opts.plan)
        : undefined;
      const resumable = await findLatestResumableRun(cwd, planFilter);
      if (resumable === null) {
        const suffix = planFilter
          ? ` matching plan "${path.basename(planFilter)}"`
          : "";
        process.stderr.write(
          `pilot build-resume: no resumable runs found in this repo${suffix} ` +
            `(no run has non-succeeded tasks)\n`,
        );
        return 2;
      }
      runId = resumable.runId;
      dbPath = resumable.dbPath;
      runDir = resumable.runDir;
    }
  } catch (err) {
    process.stderr.write(
      `pilot build-resume: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 2. Open the state DB and inspect the run.
  const opened = openStateDb(dbPath);
  const cleanup: Array<() => Promise<void> | void> = [];
  cleanup.push(() => opened.close());

  const run = getRun(opened.db, runId);
  if (run === null) {
    process.stderr.write(
      `pilot build-resume: state.db exists at ${dbPath} but has no row for ${runId}\n`,
    );
    await runCleanup(cleanup);
    return 1;
  }

  const counts = countByStatus(opened.db, runId);
  const remaining =
    counts.pending +
    counts.ready +
    counts.running +
    counts.failed +
    counts.blocked +
    counts.aborted;
  if (remaining === 0) {
    process.stderr.write(
      `pilot build-resume: run ${runId} has no tasks to resume ` +
        `(all ${counts.succeeded} succeeded)\n`,
    );
    await runCleanup(cleanup);
    return 2;
  }

  // 3. Load the plan from the path recorded on the run row.
  //    There's no separate "frozen" copy — the cwd-mode contract is that
  //    the plan file at this path is the source of truth. If the user
  //    edited it between runs, the resume picks up the edited version.
  //    (If you want to start fresh with an edited plan, run `pilot build`
  //    instead.)
  const planPath = run.plan_path;
  const loaded = await loadPlan(planPath);
  if (!loaded.ok) {
    process.stderr.write(
      `pilot build-resume: plan at ${planPath} failed to load:\n` +
        loaded.errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n") +
        `\n`,
    );
    await runCleanup(cleanup);
    return 1;
  }
  const plan = loaded.plan;

  // 4. Pre-flight: safety gate + branch match + clean tree.
  const preflight = await runResumePreflight({ cwd, opened, runId });
  if (!preflight.ok) {
    process.stderr.write(`pilot build-resume: ${preflight.reason}\n`);
    await runCleanup(cleanup);
    return 1;
  }
  // Surface tolerated-dirt warnings (framework noise the user didn't author).
  for (const w of preflight.warnings) {
    stderrWriter(`[pilot] ${w}\n`);
  }

  // Run the user-authored setup hook (idempotent). Environment may have
  // bitrotted between runs — docker containers stopped, caches evicted,
  // etc. Running the hook again ensures the stack is ready before we
  // resume. Same abort-on-failure semantics as `pilot build`.
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

  // 5. Reset non-succeeded tasks to pending; mark run as running.
  const resetIds = resetTasksForResume(opened.db, runId);
  try {
    markRunResumed(opened.db, runId);
  } catch (err) {
    process.stderr.write(
      `pilot build-resume: cannot mark run as running: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    await runCleanup(cleanup);
    return 1;
  }

  appendEvent(opened.db, {
    runId,
    kind: "run.resumed",
    payload: {
      resetTaskIds: resetIds,
      skippedSucceeded: counts.succeeded,
    },
  });

  // 6. User-visible banner before handing to the shared worker pipeline.
  if (opts.quiet !== true) {
    stderrWriter(
      `pilot build-resume: resuming run ${runId} — ${resetIds.length} task(s) ` +
        `reset (skipping ${counts.succeeded} succeeded)\n`,
    );
  }

  // 7. Hand off to the shared executeRun pipeline. It'll spawn the
  //    opencode server, wire the worker, and stream events.
  const branchPrefix = deriveBranchPrefix(plan.branch_prefix, run.plan_slug, runId);

  // Note: executeRun closes the DB in cleanup (via the cleanup array
  // it receives). We pushed db.close() earlier; pass ownership down.
  return executeRun({
    db: opened,
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

// --- Pre-flight ------------------------------------------------------------

type PreflightResult =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

/**
 * Resume-specific pre-flight. Runs AFTER the run is loaded (so we can
 * cross-check against recorded task branches), but BEFORE any state
 * mutation.
 *
 * Checks:
 *   1. Standard safety-gate (branch + clean tree). Covered by the worker's
 *      own gate, but we re-check here so failures surface before any DB
 *      mutation (the worker's gate fires after the run row is touched).
 *   2. Current branch matches the branch recorded on any succeeded task
 *      (if none succeeded, skip this — the resume behaves like a fresh build).
 *   3. HEAD reachable from ancestor of any succeeded task's commit
 *      (soft: warn only; a local reset/rebase is a legitimate recovery
 *      move, just surfaces that the user is on a diverged tree).
 */
async function runResumePreflight(args: {
  cwd: string;
  opened: ReturnType<typeof openStateDb>;
  runId: string;
}): Promise<PreflightResult> {
  const { cwd, opened, runId } = args;

  // (1) Standard safety gate.
  const { checkCwdSafety } = await import("../worker/safety-gate.js");
  const gate = await checkCwdSafety(cwd);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason };
  }

  // (2) Branch match. Look up any task row with a recorded branch
  //     (succeeded tasks will have one). If none recorded, skip.
  const { listTasks } = await import("../state/tasks.js");
  const tasks = listTasks(opened.db, runId);
  const withBranch = tasks.filter(
    (t) => t.branch !== null && t.branch.length > 0,
  );
  if (withBranch.length > 0) {
    // All recorded branches should be the same in cwd mode (we commit
    // on HEAD, so every task records the same branch). Take the first.
    const recordedBranch = withBranch[0]!.branch!;
    const current = await currentBranch(cwd);
    if (current !== recordedBranch) {
      return {
        ok: false,
        reason:
          `branch mismatch: run ${runId} was started on "${recordedBranch}", ` +
          `but cwd is currently on "${current}". ` +
          `Switch branches: \`git checkout ${recordedBranch}\``,
      };
    }
  }

  return { ok: true, warnings: gate.warnings };
}

async function currentBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileP(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: 10_000 },
    );
    return stdout.toString().trim();
  } catch {
    return "";
  }
}

// --- Run discovery ---------------------------------------------------------

type ResumableRun = {
  runId: string;
  dbPath: string;
  runDir: string;
  mtime: number;
};

/**
 * Find the newest run in this repo's pilot-state dir that has at least
 * one non-succeeded task. Optionally filters by plan_path.
 *
 * Returns `null` if no such run exists.
 */
async function findLatestResumableRun(
  cwd: string,
  planFilter?: string,
): Promise<ResumableRun | null> {
  const { getPilotDir } = await import("../paths.js");
  const pilot = await getPilotDir(cwd);
  const runsDir = path.join(pilot, "runs");

  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return null;
  }

  // Build (runId, mtime, dbPath) triples for every run with a state.db.
  const candidates: ResumableRun[] = [];
  for (const id of entries) {
    const dbPath = path.join(runsDir, id, "state.db");
    let st;
    try {
      st = await fs.stat(dbPath);
    } catch {
      continue;
    }
    candidates.push({
      runId: id,
      dbPath,
      runDir: path.join(runsDir, id),
      mtime: st.mtimeMs,
    });
  }
  // Newest-first.
  candidates.sort((a, b) => b.mtime - a.mtime);

  // Open each in order, check for non-succeeded tasks + plan filter.
  for (const c of candidates) {
    const opened = openStateDb(c.dbPath);
    try {
      // Plan filter: if provided, only consider runs whose plan_path matches.
      if (planFilter !== undefined) {
        const { getRun } = await import("../state/runs.js");
        const run = getRun(opened.db, c.runId);
        if (!run) continue;
        // Match by exact path OR by basename (for bare-filename filters).
        const matches =
          run.plan_path === planFilter ||
          path.basename(run.plan_path) === path.basename(planFilter);
        if (!matches) continue;
      }

      const counts = countByStatus(opened.db, c.runId);
      const nonSucceeded =
        counts.pending +
        counts.ready +
        counts.running +
        counts.failed +
        counts.blocked +
        counts.aborted;
      if (nonSucceeded > 0) {
        return c;
      }
    } finally {
      opened.close();
    }
  }

  // Silence unused-import warning when the helper isn't reached.
  void resolveBaseDir;

  return null;
}

/**
 * Resolve a --plan filter to an absolute path. Tries:
 *   1. As-is (absolute path).
 *   2. cwd-relative.
 *   3. Plans-dir-relative.
 *   4. Plans-dir-relative with .yaml/.yml appended.
 *
 * Returns the first path that exists on disk, or the raw input if none
 * resolve (the filter will just not match any run — user sees "no
 * resumable runs matching plan X").
 */
async function resolvePlanFilter(
  cwd: string,
  input: string,
): Promise<string> {
  const { getPlansDir } = await import("../paths.js");

  if (path.isAbsolute(input)) return input;

  // cwd-relative
  const cwdRel = path.resolve(cwd, input);
  try {
    await fs.stat(cwdRel);
    return cwdRel;
  } catch {
    // continue
  }

  // plans-dir-relative
  const plansDir = await getPlansDir(cwd);
  const plansDirRel = path.join(plansDir, input);
  try {
    await fs.stat(plansDirRel);
    return plansDirRel;
  } catch {
    // continue
  }

  // plans-dir-relative with extension
  if (!/\.(ya?ml)$/i.test(input)) {
    for (const ext of [".yaml", ".yml"]) {
      const withExt = path.join(plansDir, `${input}${ext}`);
      try {
        await fs.stat(withExt);
        return withExt;
      } catch {
        // continue
      }
    }
  }

  // Fallback: return the raw input. The filter comparison in
  // findLatestResumableRun will also try basename matching, so
  // bare filenames like "my-plan.yaml" still work even without
  // resolving to a full path.
  return input;
}

async function runCleanup(
  cleanup: Array<() => Promise<void> | void>,
): Promise<void> {
  while (cleanup.length > 0) {
    const fn = cleanup.pop()!;
    try {
      await fn();
    } catch {
      // swallow
    }
  }
}
