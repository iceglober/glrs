# Wave 3 — Parallel Execution

**Focus:** Phases that touch disjoint files should run simultaneously. This is the highest-leverage performance improvement — a 4-phase plan that takes 40 minutes sequentially could take 15 minutes with 2-3 parallel lanes.

---

## Items

- [x] 3.1 **File-overlap analysis.** Before execution, parse each phase's `files:` fields (from the plan-state items) and build a conflict graph. Two phases conflict if they share any file path. Phases with no shared files can run in parallel. Output the parallelization plan to the log: "Phases wave_1.md and wave_3.md can run in parallel (no file overlap)."

  - mirror: `packages/harness-opencode/src/autopilot/plan-parser.ts` (existing `parseItems` returns `PlanItem[]` with `files: PlanFileEntry[]` — extend or wrap it for cross-phase analysis)
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/conflict-graph.ts` — `buildConflictGraph(phases: { file: string; items: PlanItem[] }[]): ConflictGraph` and `findIndependentPhases(graph): string[][]`
    - `packages/harness-opencode/test/conflict-graph.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — call `buildConflictGraph` before the per-phase loop (line 231) and log the parallelization plan
  - context (`plan-parser.ts` PlanItem shape, lines 36-44):
    ```ts
    export interface PlanItem {
      id: string;
      intent: string;
      files: PlanFileEntry[];
      tests: string[];
      verify: string;
      checked: boolean;
    }
    export interface PlanFileEntry {
      path: string;
      isNew: boolean;
      change: string;
    }
    ```
    Use `files[].path` to compute file overlap between phases.
  - context (ConflictGraph shape):
    ```ts
    export interface ConflictGraph {
      phases: string[];                        // phase filenames
      conflicts: Map<string, Set<string>>;     // phase -> phases it conflicts with
    }
    ```
  - context (`loop-session.ts` start of per-phase loop, lines 217-231):
    ```ts
    const allPhases = detectPhaseFiles(mainContent, opts.planPath);
    const uncheckedPhases = filterUncheckedPhases(allPhases, mainContent, opts.planPath, _readFileSync);
    let totalCostUsd = 0;
    let totalIterations = 0;
    let phasesCompleted = 0;
    let lastResult: LoopResult = { exitReason: "sentinel", iterations: 0, message: "..." };
    for (const phaseFile of uncheckedPhases) { ... }
    ```
    Insert before the loop:
    ```ts
    const phaseItems = uncheckedPhases.map((f) => ({ file: f, items: parseItems(_readFileSync(path.join(opts.planPath, f))) }));
    const graph = buildConflictGraph(phaseItems);
    const groups = findIndependentPhases(graph);
    log.info({ groups }, "Parallelization plan");
    ```
  - conventions: graph operations use plain `Map` and `Set`, not external libs; conflict detection is pure (no I/O); `parseItems` is already plan-blind-degraded (returns `[]` on error); when items lack a `files:` field, treat as conflicting with everything (conservative — falls back to sequential); `bun:test`; named exports.

- [x] 3.2 **Multi-worktree execution.** For parallel phases, create temporary git worktrees (`git worktree add`) branching from the current HEAD. Each phase runs in its own worktree with its own OpenCode server. On completion, merge the worktree's branch back into the main branch. On conflict (shouldn't happen if file-overlap analysis is correct), fall back to sequential execution for the conflicting phase.

  - mirror: `packages/cli/src/` worktree-creating commands (the `glrs` CLI dispatcher's `/fresh` flow already creates worktrees — same `git worktree add` semantics); `loop.ts`'s `execFile("git", ...)` pattern (lines 126-146) is the runtime invocation shape
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/worktree.ts` — `createWorktree(repoRoot, branch): Promise<{ path: string; cleanup: () => Promise<void> }>`, `mergeWorktree(repoRoot, branch): Promise<{ ok: boolean; conflicts?: string[] }>`
    - `packages/harness-opencode/test/worktree.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — when a group from 3.1 has > 1 phase, dispatch each to a worktree (via `createWorktree`) and run `_runRalphLoop` against the worktree path; on completion, merge back
  - context (existing git invocation pattern in `loop.ts`, lines 126-146):
    ```ts
    async function checkProgress(cwd: string, baseRef: string): Promise<boolean> {
      try {
        const { stdout } = await execFile("git", ["diff", "--stat", baseRef], { cwd });
        return stdout.trim().length > 0;
      } catch { return true; }
    }
    async function getHeadSha(cwd: string): Promise<string> {
      try {
        const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
        return stdout.trim();
      } catch { return "HEAD"; }
    }
    ```
    Reuse this exact `execFile + try/catch` shape for `git worktree add`, `git worktree remove`, `git merge --no-ff`, and `git branch -D`.
  - context (worktree command sequence):
    ```bash
    git worktree add ./.agent/worktrees/<lane-id> -b autopilot/<phase-slug>
    # ... agent runs in that worktree path ...
    git -C <main-repo-path> merge --no-ff autopilot/<phase-slug>
    git worktree remove ./.agent/worktrees/<lane-id>
    git branch -D autopilot/<phase-slug>
    ```
    Worktree path: `path.join(repoRoot, ".agent/worktrees", `<lane>-${Date.now()}`)`.
  - conventions: worktree paths under `.agent/worktrees/` (matches existing `.agent/` convention for kill-switch + status); branches use `autopilot/<phase-slug>` prefix; `git merge --no-ff` to preserve per-phase commits in history; merge conflicts fall back to sequential — never resolve automatically; cleanup is best-effort and logs warnings on failure (don't throw); `bun:test` with mocked `execFile`; ESM imports with `.js`.

- [x] 3.3 **Parallel lane orchestrator.** Replace the sequential `for (const phaseFile of uncheckedPhases)` loop in `loop-session.ts` with a lane-based orchestrator. The orchestrator maintains N lanes (default: 2, configurable via `--parallel <n>`). Each lane runs one phase at a time. When a lane finishes, it picks up the next available non-conflicting phase. Phases that conflict with any running lane wait in a queue.

  - mirror: `packages/harness-opencode/src/autopilot/loop-session.ts` (the existing for-loop at line 231 — replace its body with lane scheduling); the cost-tracker plugin's `lastSeen` `Map` pattern (lines 195-204) is the reference for tracking active lanes
  - files (NEW):
    - `packages/harness-opencode/src/autopilot/lane-orchestrator.ts` — `runLanes({ phases, conflictGraph, laneCount, runPhase })`
    - `packages/harness-opencode/test/lane-orchestrator.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — replace the sequential `for (const phaseFile of uncheckedPhases)` block (lines 231-273) with `await runLanes({ phases: uncheckedPhases, conflictGraph: graph, laneCount: opts.parallel ?? 1, runPhase })`
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — add `parallel: option({ long: "parallel", type: optional(numberType), defaultValue: () => 1, ... })`
  - context (current sequential loop, `loop-session.ts` lines 231-273):
    ```ts
    for (const phaseFile of uncheckedPhases) {
      const phasePath = path.join(opts.planPath, phaseFile);
      const phaseContent = _readFileSync(phasePath);
      const prompt = `... ## Your phase (${phaseFile})\n${phaseContent}\n\n ...`;
      const result = await _runRalphLoop({ prompt, cwd: opts.cwd, agentName: opts.fast ? "autopilot-fast" : undefined });
      totalIterations += result.iterations;
      totalCostUsd += result.cumulativeCostUsd ?? 0;
      lastResult = result;
      const updatedPhaseContent = _readFileSync(phasePath);
      const phaseComplete = isPhaseComplete(updatedPhaseContent);
      if (phaseComplete) {
        phasesCompleted++;
        const updatedMain = markPhaseChecked(_readFileSync(mainMdPath), phaseFile);
        _writeFileSync(mainMdPath, updatedMain);
      }
      if (!phaseComplete && !SUCCESS_REASONS.has(result.exitReason)) {
        return { ...result, iterations: totalIterations, ... };
      }
    }
    ```
    Extract the body into `runPhase(phaseFile): Promise<PhaseResult>` and pass to `runLanes`.
  - context (lane-orchestrator algorithm):
    1. Build a queue of phases sorted by dependency order.
    2. While queue non-empty OR active lanes > 0:
       - For each idle lane up to `laneCount`: pick the next queue phase that doesn't conflict with any currently-running phase.
       - When a lane finishes, free the lane and re-evaluate the queue.
    3. Return aggregated `PhaseResult[]` in completion order.
  - conventions: orchestrator uses `Promise.race` to wait for any lane to finish; cancellation via injected `AbortSignal`; `laneCount: 1` falls back to identical sequential semantics (preserve current behavior as default); `bun:test` with deterministic fake `runPhase` to verify scheduling; named exports; ESM `.js` imports.

- [x] 3.4 **Merged progress reporting.** When running parallel lanes, interleave progress logs with lane prefixes: `[lane-1] tool: edit sidebar.tsx` / `[lane-2] tool: bash pnpm test`. Iteration summaries show per-lane and aggregate stats. The status file (1.4) includes all active lanes.

  - mirror: `packages/harness-opencode/src/lib/logger.ts` (existing `childLogger(root, "autopilot.tool")` pattern — create lane-keyed children); `packages/harness-opencode/src/autopilot/loop.ts` lines 175-179 show the four childLogger creations
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — accept an optional `laneId?: string` in `RalphLoopOptions`; when set, prefix all log lines with `[lane-${laneId}]` via a lane-scoped `childLogger`
    - `packages/harness-opencode/src/autopilot/status.ts` — extend `StatusState` with `lanes?: Record<string, LaneState>` and update `composeStatusMessage` to render multi-lane status
  - context (existing childLogger usage, `loop.ts` lines 175-179):
    ```ts
    const autopilotLog = createAutopilotLogger({ cwd: opts.cwd });
    const log = childLogger(autopilotLog.root, "autopilot.loop");
    const toolLog = childLogger(autopilotLog.root, "autopilot.tool");
    const streamLog = childLogger(autopilotLog.root, "autopilot.stream");
    const statusLog = childLogger(autopilotLog.root, "autopilot.status");
    ```
    With laneId, use `childLogger(autopilotLog.root, `autopilot.loop.lane.${laneId}`)` instead.
  - context (`status.ts` `composeStatusMessage`, lines 98-121):
    ```ts
    export function composeStatusMessage(state: StatusState, now: number): string {
      const elapsed = formatElapsed(now - state.startedAt);
      const cost = formatCost(state.cumulativeCostUsd);
      const iterNote = state.iterationsCompleted === 0
        ? "iteration 1 in flight"
        : `${state.iterationsCompleted} iteration${...} complete`;
      let planNote = "";
      if (state.phaseCount !== undefined && ...) {
        planNote = `, phase ${state.phasesCompleted}/${state.phaseCount}, ...`;
      }
      if (state.lastIterationErrored) { return `working (...) — last iteration errored`; }
      return `working (${iterNote}, ${elapsed} elapsed, ${cost} used${planNote})`;
    }
    ```
    Add a `laneNote` segment when `state.lanes` is set: `, lanes: [lane-1: phase_2 iter 3, lane-2: phase_4 iter 1]`.
  - conventions: pino childLoggers automatically prefix; no manual string prefixing; `LaneState` shape: `{ phaseFile: string; iteration: number; lastTool?: string }`; tests verify the message structure with snapshot-style assertions; `bun:test`.

- [x] 3.5 **Parallel cost tracking.** Each lane has its own OpenCode server and session. Cost accumulation must sum across all lanes. The final debrief reports per-lane and total cost.

  - mirror: `packages/harness-opencode/src/plugins/cost-tracker.ts` lines 235-274 (`applyToRollup` accumulates into the rollup safely — same pattern works for lane-keyed accumulation); `loop-session.ts` lines 243-244 show the existing single-stream `totalCostUsd += result.cumulativeCostUsd ?? 0`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — replace the scalar `totalCostUsd` with a `Map<laneId, number>` and aggregate at the end
    - `packages/harness-opencode/src/autopilot/debrief.ts` — extend `buildContextMessage` (lines 94-127) to include per-lane cost breakdown when `loopResult.laneCosts` is set
  - context (`loop-session.ts` cost accumulation, lines 219-244):
    ```ts
    let totalCostUsd = 0;
    let totalIterations = 0;
    let phasesCompleted = 0;
    let lastResult: LoopResult = { ... };
    for (const phaseFile of uncheckedPhases) {
      ...
      const result = await _runRalphLoop({ ... });
      totalIterations += result.iterations;
      totalCostUsd += result.cumulativeCostUsd ?? 0;
      lastResult = result;
      ...
    }
    ```
    Replace `totalCostUsd` scalar with `const laneCosts = new Map<string, number>()`; `laneCosts.set(laneId, (laneCosts.get(laneId) ?? 0) + (result.cumulativeCostUsd ?? 0))`; final total = sum of values.
  - context (`debrief.ts` buildContextMessage, lines 94-127):
    ```ts
    const cost = loopResult.cumulativeCostUsd !== undefined
      ? `$${loopResult.cumulativeCostUsd.toFixed(4)}` : "not available";
    return [
      "## Autopilot session context",
      "",
      `**Exit reason:** ${loopResult.exitReason}`,
      `**Iterations completed:** ${loopResult.iterations}`,
      `**Cumulative cost:** ${cost}`,
      ...
    ].join("\n");
    ```
    When `loopResult.laneCosts` is present, append a per-lane breakdown table.
  - conventions: cost values stored as numbers (USD); aggregation is sum across all lanes; per-lane reporting is opt-in (only shown when there's > 1 lane); `LoopResult` field additions must be optional to preserve back-compat; `bun:test`; named exports.

- [x] 3.6 **Worktree cleanup.** After all phases complete (or on error/interrupt), remove temporary worktrees. The main worktree has the merged result. If any merge failed, leave the worktree intact and log its path for manual resolution.

  - mirror: `packages/harness-opencode/src/autopilot/worktree.ts` (the new module from 3.2 — its `cleanup` callback returned by `createWorktree` is what gets called here)
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — after the lane orchestrator returns, iterate active worktrees and call each `cleanup()`; on merge failure, skip cleanup and log the surviving worktree path
    - `packages/harness-opencode/src/autopilot/loop.ts` — add cleanup to the SIGINT handler (from 2.4) so worktrees aren't orphaned on Ctrl+C
  - context (`loop-session.ts` post-loop completion, lines 275-299):
    ```ts
    // All phases done. Now execute main.md's own cross-cutting acceptance criteria...
    const finalMainContent = _readFileSync(mainMdPath);
    const mainHasUnchecked = /^- \[ \]\s+id:/m.test(finalMainContent);
    if (mainHasUnchecked) { ... }
    return {
      ...lastResult,
      iterations: totalIterations,
      cumulativeCostUsd: totalCostUsd,
      message: `${phasesCompleted}/${uncheckedPhases.length} phases completed in ${totalIterations} iterations, total $${totalCostUsd.toFixed(2)}`,
    };
    ```
    Insert worktree cleanup loop BEFORE the cross-cutting `if (mainHasUnchecked)` block: `for (const wt of activeWorktrees) { await wt.cleanup().catch((err) => log.warn({ err }, "worktree cleanup failed")); }`.
  - context (cleanup signature from 3.2's worktree.ts):
    ```ts
    interface WorktreeHandle {
      path: string;
      cleanup: () => Promise<void>;  // git worktree remove + branch -D
    }
    ```
  - conventions: cleanup is best-effort — failures log warnings, never throw; orphaned worktrees are surfaced in the debrief output (3.5) with their disk path so the user can `git worktree remove --force <path>` manually; on SIGINT (2.4), call cleanup synchronously in the signal handler before exit; `bun:test`; ESM `.js` imports.

- [x] 3.7 **Sequential fallback.** If `--parallel 1` or if all phases conflict (every phase touches a shared file), fall back to the current sequential behavior. No worktrees created, no merge step. The parallelization is purely opportunistic.

  - mirror: `packages/harness-opencode/src/autopilot/loop-session.ts`'s current sequential loop (lines 231-273) — preserve as the fallback path; the lane orchestrator from 3.3 with `laneCount: 1` should already collapse to sequential, but skip worktree creation entirely when `laneCount === 1` to avoid overhead
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — early-return to the sequential path when `opts.parallel === 1` OR when `findIndependentPhases(graph).every(g => g.length === 1)` (every group is size 1)
    - `packages/harness-opencode/src/autopilot/lane-orchestrator.ts` — when `laneCount === 1`, skip worktree creation; use the current `cwd` directly
  - context (early-return decision in `loop-session.ts`):
    ```ts
    const groups = findIndependentPhases(graph);
    const hasParallelism = groups.some((g) => g.length > 1);
    const useSequential = (opts.parallel ?? 1) === 1 || !hasParallelism;
    if (useSequential) {
      // existing sequential for-loop unchanged (lines 231-273)
    } else {
      // lane-orchestrator path (3.3)
    }
    ```
  - context (sequential loop is the source of truth — DO NOT remove it; new code paths must preserve identical behavior when `parallel === 1`):
    ```ts
    for (const phaseFile of uncheckedPhases) {
      const phasePath = path.join(opts.planPath, phaseFile);
      const phaseContent = _readFileSync(phasePath);
      const prompt = `... ## Your phase (${phaseFile})\n${phaseContent}\n\n ...`;
      const result = await _runRalphLoop({ prompt, cwd: opts.cwd, agentName: opts.fast ? "autopilot-fast" : undefined });
      ...
    }
    ```
  - conventions: default `--parallel` value is 1 (preserve current behavior); fallback decisions logged at info level so the user understands why parallelism was skipped; tests verify both paths produce identical results for plans where parallelism isn't possible; `bun:test`; named exports.
