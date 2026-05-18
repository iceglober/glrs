/**
 * Loop session runner for the interactive autopilot orchestrator.
 *
 * For multi-file plans (directory with main.md + phase_N.md files):
 *   - Reads main.md to extract Goal and Constraints sections
 *   - Detects unchecked phase files from the ## Phases section
 *   - Creates a fresh runRalphLoop session per phase with a prompt
 *     containing Goal + Constraints + full phase file contents
 *   - After each successful phase, updates main.md's phase checkbox
 *   - Stops early if a phase exits with struggle/stall/error/timeout
 *
 * For single-file plans (.md file):
 *   - Unchanged behavior: single runRalphLoop call with a direct prompt
 */

import * as fs from "node:fs";
import * as path from "node:path";
import pino from "pino";
import { runRalphLoop, type LoopResult, type RalphLoopOptions } from "./loop.js";
import type { LoopSessionOptions } from "./loop-session-types.js";
import type { SessionEventEmitter } from "./session-runner.js";
import {
  writeCheckpoint,
  deleteCheckpoint,
  readCheckpoint,
  type Checkpoint,
} from "./checkpoint.js";
import { recordHead, resetSoft } from "./git-safety.js";
import { parseItems } from "./plan-parser.js";
import { hasSpec, readSpecGoal, readSpecConstraints, detectSpecPhases, filterUncheckedSpecPhases, parseSpecItems } from "./spec-parser.js";
import { markPhaseCompleted as specMarkPhaseCompleted } from "./spec-writer.js";
import { buildConflictGraph, hasParallelism } from "./conflict-graph.js";
import { runLanes, type PhaseResult } from "./lane-orchestrator.js";
import {
  createWorktree,
  mergeWorktree,
  type WorktreeHandle,
} from "./worktree.js";
import {
  runVerifyCommands,
  type VerifyResult,
  type VerifyStrategy,
} from "./verify-runner.js";
import { runHook } from "./hook-runner.js";
import { validatePlan } from "./plan-validator.js";
import { resolveModel, type AdapterName } from "./model-resolver.js";
import { MAX_ITERATIONS_PER_PHASE_BY_TIER, MAX_ITERATIONS_PER_ITEM, STALL_MS_BY_TIER } from "./config.js";
import { resolvePhaseConfig } from "./phase-config.js";

export type { LoopSessionOptions, LoopResult };

/**
 * Injectable dependencies for testing.
 * @internal
 */
export interface LoopSessionDeps {
  runRalphLoop?: (opts: RalphLoopOptions) => Promise<LoopResult>;
  /** Override filesystem stat check for testing. */
  isDirectory?: (p: string) => boolean;
  /** Override fs.readFileSync for testing. */
  readFileSync?: (p: string) => string;
  /** Override fs.writeFileSync for testing. */
  writeFileSync?: (p: string, content: string) => void;
  /**
   * Override the post-phase verify-command runner (item 4.1) for tests
   * that don't want to actually shell out. Default: real implementation
   * from `verify-runner.ts`.
   */
  runVerifyCommands?: typeof runVerifyCommands;
}

/**
 * Extract verify configuration from the resolved config object.
 * Defaults: strategy = "after_phase", timeout = 5 min, retry = true.
 */
function extractVerifyConfig(config: unknown): {
  strategy: VerifyStrategy;
  timeoutMs: number;
  retryOnFailure: boolean;
} {
  const cfgObj = config as Record<string, unknown> | undefined;
  const strategy = (cfgObj?.verify ?? "after_phase") as VerifyStrategy;
  const timeoutMs = (cfgObj?.verify_timeout ?? 5 * 60 * 1000) as number;
  const retryOnFailure = (cfgObj?.verify_retry ?? true) as boolean;
  return { strategy, timeoutMs, retryOnFailure };
}

/**
 * Extract hooks configuration from the resolved config object.
 * Hooks are optional; when not set, all are undefined (no-op).
 */
function extractHooksConfig(config: unknown): {
  pre_phase?: string;
  post_phase?: string;
  post_run?: string;
  on_error?: string;
} {
  const cfgObj = config as Record<string, unknown> | undefined;
  return {
    pre_phase: cfgObj?.hooks?.pre_phase as string | undefined,
    post_phase: cfgObj?.hooks?.post_phase as string | undefined,
    post_run: cfgObj?.hooks?.post_run as string | undefined,
    on_error: cfgObj?.hooks?.on_error as string | undefined,
  };
}

/**
 * Extract a named section from markdown content.
 * Returns the text between `## <name>` and the next `##` heading (or EOF).
 */
function extractSection(content: string, sectionName: string): string {
  const re = new RegExp(
    `^## ${sectionName}\\s*\\n([\\s\\S]*?)(?=^## |$)`,
    "m",
  );
  const match = re.exec(content);
  return match ? match[1].trim() : "";
}

/**
 * Parse phase/wave file references from main.md.
 *
 * Tries multiple formats:
 * 1. Checkbox lines: `- [ ] wave_1.md — ...` or `- [ ] [phase_1.md](...)`
 * 2. Markdown table cells: `[wave_1.md](./wave_1.md)`
 * 3. Fallback: scan the directory for any .md files that aren't main/scope
 *
 * Returns ALL phase files found (not just unchecked ones) — the caller
 * decides which to skip based on completion state.
 */
function detectPhaseFiles(mainContent: string, planDir: string): string[] {
  const found = new Set<string>();

  // 1. Checkbox lines: `- [ ] file.md` or `- [x] file.md` or `- [ ] [file.md](...)`
  const checkboxRe = /^- \[[ xX]\]\s+(?:\[)?([a-zA-Z0-9_-]+\.md)(?:\]\([^)]*\))?/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(mainContent)) !== null) {
    found.add(match[1]);
  }

  // 2. Markdown link references in tables or prose: [file.md](./file.md)
  const linkRe = /\[([a-zA-Z0-9_-]+\.md)\]\(\.\//g;
  while ((match = linkRe.exec(mainContent)) !== null) {
    found.add(match[1]);
  }

  // 3. Fallback: scan directory if nothing found
  if (found.size === 0) {
    try {
      const entries = fs.readdirSync(planDir);
      for (const f of entries) {
        if (
          f.endsWith(".md") &&
          f !== "main.md" &&
          f !== "scope.md" &&
          f !== "scope-seed.md"
        ) {
          found.add(f);
        }
      }
    } catch {
      // Directory read failure — return empty
    }
  }

  // Sort naturally: wave_1 before wave_2 before wave_10
  return [...found].sort((a, b) => {
    const numA = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
    const numB = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
    return numA - numB;
  });
}

/**
 * Filter to only unchecked phases. A phase is "unchecked" if main.md
 * has `- [ ] <filename>` for it, OR if main.md doesn't use checkbox
 * references at all (table/fallback format — check the phase file itself).
 */
function filterUncheckedPhases(
  phaseFiles: string[],
  mainContent: string,
  planDir: string,
  readFile: (p: string) => string,
): string[] {
  // If main.md uses checkbox references, filter by checkbox state
  const checkedRe = /^- \[x\]\s+(?:\[)?([a-zA-Z0-9_-]+\.md)/gm;
  const checked = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = checkedRe.exec(mainContent)) !== null) {
    checked.add(match[1]);
  }

  // If main.md has checkbox references, use them to filter
  const hasCheckboxRefs = /^- \[[ xX]\]\s+(?:\[)?[a-zA-Z0-9_-]+\.md/m.test(mainContent);
  if (hasCheckboxRefs) {
    return phaseFiles.filter((f) => !checked.has(f));
  }

  // No checkbox references in main.md — check each phase file's own items
  return phaseFiles.filter((f) => {
    try {
      const content = readFile(path.join(planDir, f));
      return !isPhaseComplete(content);
    } catch {
      return true; // Can't read → assume unchecked
    }
  });
}

/**
 * Check whether a phase file has all its items completed.
 * Returns true if all checkboxes are checked, OR if there are no checkboxes
 * (nothing to track = nothing left to do).
 */
function isPhaseComplete(phaseContent: string): boolean {
  const checkboxRe = /^[ \t]*-\s+\[([ xX])\]/gm;
  let total = 0;
  let checked = 0;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(phaseContent)) !== null) {
    total++;
    if (match[1] !== " ") checked++;
  }
  return total === 0 || checked === total;
}

/**
 * Update main.md to mark a phase checkbox as checked.
 * Replaces `- [ ] <filename>` with `- [x] <filename>`.
 * Handles both bare filenames and markdown links.
 */
function markPhaseChecked(mainContent: string, phaseFile: string): string {
  const escaped = phaseFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match both bare `- [ ] file.md` and linked `- [ ] [file.md](...)`
  const re = new RegExp(`^(- )\\[ \\](\\s+(?:\\[)?${escaped})`, "m");
  return mainContent.replace(re, "$1[x]$2");
}

/** Exit reasons that indicate a successful phase completion. */
const SUCCESS_REASONS = new Set(["sentinel", "idle", "max-iterations"]);

/**
 * Filter to only unchecked phases using the YAML spec's `completed` field.
 * A phase is "unchecked" when its `completed` field is false in spec/main.yaml.
 */
function filterUncheckedPhasesYaml(
  phaseFiles: string[],
  planDir: string,
): string[] {
  return filterUncheckedSpecPhases(phaseFiles, planDir);
}

/**
 * Run a headless loop session against a plan.
 *
 * Detects whether planPath is a directory (multi-file plan) or a file
 * (single-file plan) and shapes the prompt accordingly, then delegates
 * to runRalphLoop.
 */
export async function runLoopSession(
  opts: LoopSessionOptions & { _deps?: LoopSessionDeps },
): Promise<LoopResult> {
  const _runRalphLoop = opts._deps?.runRalphLoop ?? runRalphLoop;
  const _readFileSync =
    opts._deps?.readFileSync ??
    ((p: string) => fs.readFileSync(p, "utf8"));
  const _writeFileSync =
    opts._deps?.writeFileSync ??
    ((p: string, content: string) => fs.writeFileSync(p, content, "utf8"));
  const _runVerifyCommands = opts._deps?.runVerifyCommands ?? runVerifyCommands;

  // Typed event emitter (Channel 1) — optional, wired by SessionRunner.
  const emitter: SessionEventEmitter | undefined = opts.emitter;

  // Plan structure validation (item 4.5). Fail fast on missing main.md
  // or referenced-but-absent phase files instead of discovering them
  // mid-execution. Pre-execution warnings (e.g., items missing
  // verify:/tests:/files:) flow into the loop logger so the user sees
  // them before any iterations run. Errors short-circuit the run.
  // Logged at the orchestrator-level pino once we have it; here we use
  // a minimal local logger to surface the report.
  //
  // Validation is skipped when test deps (readFileSync, isDirectory,
  // etc.) are injected — those tests use synthetic in-memory paths that
  // would fail the real-fs check. The cmd-layer's call to validatePlan
  // (autopilot-cmd.ts) already covers the production path.
  if (!opts._deps) {
    const report = validatePlan(opts.planPath);
    if (report.errors.length > 0 || report.warnings.length > 0) {
      const earlyLog = opts.logger
        ? opts.logger.root.child({ component: "autopilot.plan-validator" })
        : null;
      for (const w of report.warnings) {
        if (earlyLog) {
          earlyLog.warn(
            {
              code: w.code,
              ...(w.file ? { file: w.file } : {}),
              ...(w.itemId ? { itemId: w.itemId } : {}),
            },
            w.message,
          );
        }
      }
      if (report.errors.length > 0) {
        for (const e of report.errors) {
          if (earlyLog) {
            earlyLog.error(
              {
                code: e.code,
                ...(e.file ? { file: e.file } : {}),
                ...(e.itemId ? { itemId: e.itemId } : {}),
              },
              e.message,
            );
          }
        }
        return {
          exitReason: "error",
          iterations: 0,
          message: `Plan validation failed: ${report.errors
            .map((e) => e.message)
            .join("; ")}`,
        };
      }
    }
  }

  // Determine if the plan is multi-file (directory) or single-file
  const isDirectory = opts._deps?.isDirectory
    ? opts._deps.isDirectory(opts.planPath)
    : (() => {
        try {
          return fs.statSync(opts.planPath).isDirectory();
        } catch {
          return false;
        }
      })();

  if (!isDirectory) {
    // Single-file plan: unchanged behavior
    const prompt =
      `Work the plan at ${opts.planPath}. ` +
      `Complete all items in ## Acceptance criteria. ` +
      `Mark items done as they complete.`;
    const adapterName = opts.adapter?.name as AdapterName | undefined;
    const singleFileCfgObj = opts.config as Record<string, unknown> | undefined;
    const models = singleFileCfgObj?.models as Record<string, unknown> | undefined;
    const executionSpecifier = models?.execution as string | undefined;
    const executionModel = executionSpecifier
      ? resolveModel(executionSpecifier, adapterName ?? "opencode")
      : undefined;
    // Extract stall_timeout from config for this single-file run
    const singleFileStallMs = (singleFileCfgObj?.stall_timeout as number | undefined) ?? STALL_MS_BY_TIER[(opts.fast ? "autopilot-execute" : "deep")];
    const singleFileAgentOverrides = (
      (opts.config as Record<string, unknown> | undefined)?.adapters as Record<string, unknown> | undefined
    )?.opencode?.agents as Record<string, Record<string, unknown>> | undefined;
    return _runRalphLoop({
      prompt,
      cwd: opts.cwd,
      agentName: opts.fast ? "autopilot-fast" : undefined,
      model: executionModel,
      stallMs: singleFileStallMs,
      config: opts.config,
      agentOverrides: singleFileAgentOverrides,
      logger: opts.logger,
      emitter,
      adapter: opts.adapter,
    });
  }

  // Multi-file plan: per-phase session execution
  // Phase-level logger — file sink only via the shared AutopilotLogger
  // when available, otherwise a minimal stderr JSON logger as fallback.
  const log = opts.logger
    ? opts.logger.root.child({ component: "autopilot.orchestrator" })
    : pino(
        { level: "info", timestamp: pino.stdTimeFunctions.isoTime },
        pino.destination({ fd: 2, sync: false }),
      ).child({ component: "autopilot.orchestrator" });

  // Resolve the tier so we can pick a per-phase iteration budget
  // (item 2.7). Resolution order: CLI override > config.max_iterations_per_phase > tier default.
  const tier: keyof typeof MAX_ITERATIONS_PER_PHASE_BY_TIER = opts.fast
    ? "autopilot-execute"
    : "deep";
  const cfgObj = opts.config as Record<string, unknown> | undefined;
  const cfgMaxIterPerPhase = cfgObj?.max_iterations_per_phase as number | undefined;
  const maxIterationsPerPhase =
    opts.maxIterationsPerPhase ?? cfgMaxIterPerPhase ?? MAX_ITERATIONS_PER_PHASE_BY_TIER[tier];
  // Extract stall_timeout from config for runRalphLoop calls.
  // Resolution order: config.stall_timeout > tier default.
  const cfgStallMs = cfgObj?.stall_timeout as number | undefined;
  const stallMs = cfgStallMs ?? STALL_MS_BY_TIER[tier];

  // Extract hooks configuration (item 3.3)
  const verifyConfig = extractVerifyConfig(opts.config);
  const hooksConfig = extractHooksConfig(opts.config);

  const mainMdPath = path.join(opts.planPath, "main.md");

  // YAML spec path: read goal/constraints/phases from spec/main.yaml when available
  const useYamlSpec = hasSpec(opts.planPath);

  let goal: string;
  let constraints: string;
  let allPhases: string[];

  if (useYamlSpec) {
    goal = readSpecGoal(opts.planPath);
    constraints = readSpecConstraints(opts.planPath);
    allPhases = detectSpecPhases(opts.planPath);
  } else {
    const mainContent = _readFileSync(mainMdPath);
    goal = extractSection(mainContent, "Goal");
    constraints = extractSection(mainContent, "Constraints");
    allPhases = detectPhaseFiles(mainContent, opts.planPath);
  }

  // For unchecked-phase filtering, we need mainContent for the markdown path
  const mainContentForFilter = useYamlSpec ? "" : _readFileSync(mainMdPath);
  let uncheckedPhases = useYamlSpec
    ? filterUncheckedPhasesYaml(allPhases, opts.planPath)
    : filterUncheckedPhases(allPhases, mainContentForFilter, opts.planPath, _readFileSync);

  // Resume support: when --resume is set (or a checkpoint exists for the
  // current plan), skip phases already listed in `completedPhases`.
  // Validation: the checkpoint's planPath MUST exactly match opts.planPath
  // — otherwise we discard it and start fresh (with a warning).
  let resumedFromCheckpoint = false;
  if (opts.resume) {
    const cp = readCheckpoint(opts.cwd);
    if (cp) {
      if (cp.planPath !== opts.planPath) {
        log.warn({ expected: opts.planPath, found: cp.planPath }, "checkpoint planPath mismatch, starting fresh");
      } else {
        const skip = new Set(cp.completedPhases);
        const before = uncheckedPhases.length;
        uncheckedPhases = uncheckedPhases.filter((p) => !skip.has(p));
        const skipped = before - uncheckedPhases.length;
        if (skipped > 0) {
          log.info({ skipped, remaining: uncheckedPhases.length }, "resuming from checkpoint");
          resumedFromCheckpoint = true;
        }
      }
    } else {
      log.info("no checkpoint found, starting fresh");
    }
  }

  log.info({ total: allPhases.length, remaining: uncheckedPhases.length }, "plan loaded");

  // Emit plan:loaded event so the renderer can show what's happening
  emitter?.emitEvent({
    type: "phase:start",
    timestamp: new Date().toISOString(),
    phase: `plan loaded: ${uncheckedPhases.length}/${allPhases.length} phases remaining`,
    laneId: "lane-1",
    current: 0,
    total: allPhases.length,
  });

  if (uncheckedPhases.length === 0) {
    log.info("all phases already complete — nothing to do");
    emitter?.emitEvent({
      type: "phase:done",
      timestamp: new Date().toISOString(),
      phase: "all phases already complete",
      laneId: "lane-1",
      completed: true,
      iterations: 0,
      costUsd: 0,
    });
    return {
      exitReason: "sentinel",
      iterations: 0,
      message: "All phases already complete — nothing to do",
      cumulativeCostUsd: 0,
    };
  }

  for (const p of uncheckedPhases) {
    log.info({ file: p }, "phase file");
  }

  // Build the conflict graph (item 3.1) and decide whether to run in
  // parallel. Phases with parseable plan-state items declaring disjoint
  // files can run in their own worktrees concurrently (items 3.2 + 3.3);
  // anything else falls back to sequential (item 3.7) — including when
  // the user passes --parallel 1.
  const phaseInputs = uncheckedPhases.map((f) => ({
    file: f,
    items: (() => {
      try {
        return parseItems(_readFileSync(path.join(opts.planPath, f)));
      } catch {
        return [];
      }
    })(),
  }));
  const conflictGraph = buildConflictGraph(phaseInputs);
  const planParallel = hasParallelism(conflictGraph);
  const requestedLanes = Math.max(1, opts.parallel ?? 1);
  const useParallel = requestedLanes > 1 && planParallel;
  if (uncheckedPhases.length > 1) {
    if (useParallel) {
      log.info(
        { lanes: requestedLanes, phases: uncheckedPhases.length },
        "parallelization plan: independent phases will run in worktrees",
      );
    } else if (requestedLanes > 1 && !planParallel) {
      log.info(
        { lanes: requestedLanes },
        "parallelization plan: every phase shares a file — falling back to sequential",
      );
    } else {
      log.info({ lanes: 1 }, "parallelization plan: sequential");
    }
  }

  // Accumulate cost and iterations across all phases so the final
  // LoopResult reflects the total run, not just the last phase.
  // When resuming, seed with the checkpoint's prior totals so the final
  // summary reflects the full run, not just this resumed slice.
  let totalCostUsd = 0;
  let totalIterations = 0;
  let phasesCompleted = 0;
  // Per-lane cost accumulator (item 3.5). Sequential runs assign every
  // phase to "lane-1"; parallel runs distribute across lane-1..lane-N.
  // The final result includes this map only when > 1 lane was used so
  // the breakdown isn't noisy on the common case.
  const laneCosts = new Map<string, number>();
  // Surviving worktrees from failed merges (item 3.6) — surfaced in the
  // final result for the user to clean up manually.
  const orphanedWorktrees: string[] = [];
  // Per-phase verify-command results (item 4.1). Surfaced in the final
  // result for the debrief; failures also gate phase completion.
  const verifyResults: Array<{ phaseFile: string; results: VerifyResult[] }> =
    [];
  // Track which phases have completed across the WHOLE run (including
  // pre-resume ones), used as the source of truth for checkpoint writes.
  const completedPhasesAcc: string[] = [];
  if (resumedFromCheckpoint) {
    const cp = readCheckpoint(opts.cwd);
    if (cp) {
      totalCostUsd = cp.totalCostUsd;
      totalIterations = cp.totalIterations;
      completedPhasesAcc.push(...cp.completedPhases);
    }
  }

  let lastResult: LoopResult = {
    exitReason: "sentinel",
    iterations: 0,
    message: "No phases to execute.",
  };

  /**
   * Per-item iteration budget for the fast executor (item 4.8).
   * Resolution order: config.max_iterations_per_item > default constant.
   * Each item gets a fresh session with this much rope before we move
   * on. The phase's overall budget (`maxIterationsPerPhase`) divided by
   * item count is also a reasonable upper bound — we use the smaller
   * of the two so a phase with many items doesn't blow past its global
   * budget.
   */
  const cfgMaxIterPerItem = (opts.config as Record<string, unknown> | undefined)?.max_iterations_per_item as number | undefined;
  const maxIterationsPerItem = cfgMaxIterPerItem ?? MAX_ITERATIONS_PER_ITEM;

  /**
   * Per-item runner for the fast executor (item 4.8). Iterates the
   * phase's unchecked items in order, dispatching a fresh _runRalphLoop
   * session per item with a tightly-scoped prompt. Returns the LAST
   * item's LoopResult — the caller treats it as the phase result for
   * cost/iteration accounting (totals are summed inside this helper).
   *
   * If any item fails (non-success exit reason), we stop early and
   * return that result — letting the caller's error path handle it.
   * Otherwise we move through every item and return a synthesized
   * "all items done" result.
   */
  const runItemsForPhase = async (args: {
    phaseFile: string;
    phasePath: string;
    laneId: string;
    runCwd: string;
    runRalphLoop: typeof runRalphLoop;
    readFileSync: (p: string) => string;
    useParallel: boolean;
    stallMs?: number;
    logger?: import("./lib/logger.js").AutopilotLogger;
    emitter?: SessionEventEmitter;
    adapter?: import("./adapter.js").AgentAdapter;
    config?: unknown;
    agentOverrides?: Record<string, Record<string, unknown>>;
    verifyConfig?: ReturnType<typeof extractVerifyConfig>;
  }): Promise<LoopResult> => {
    const { phaseFile, phasePath, laneId, runCwd, useParallel } = args;
    const phaseContent = args.readFileSync(phasePath);
    const items = (useYamlSpec
      ? parseSpecItems(phasePath)
      : parseItems(phaseContent)
    ).filter((it) => !it.checked);

    if (items.length === 0) {
      // Fall through: no items parsed (legacy plan or pre-fence format).
      // Run the per-phase prompt as a fallback so we don't no-op silently.
      const prompt =
        `You are executing one phase of a multi-file plan. Work through every unchecked item in order. Check each box as you complete it. Commit when the phase is done.\n\n` +
        `## Overall goal\n${goal}\n\n` +
        `## Constraints\n${constraints}\n\n` +
        `## Your phase (${phaseFile})\n${phaseContent}\n\n` +
        `Do not work on items from other phases. Do not ask questions.`;
      const adapterName = args.adapter?.name as AdapterName | undefined;
      const cfgObj = args.config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const executionSpecifier = models?.execution as string | undefined;
      const executionModel = executionSpecifier
        ? resolveModel(executionSpecifier, adapterName ?? "opencode")
        : undefined;
      return args.runRalphLoop({
        prompt,
        cwd: runCwd,
        agentName: "autopilot-fast",
        model: executionModel,
        maxIterations: maxIterationsPerPhase,
        ...(args.stallMs ? { stallMs: args.stallMs } : {}),
        config: args.config,
        agentOverrides: args.agentOverrides,
        laneId: useParallel ? laneId : undefined,
        logger: args.logger,
        emitter: args.emitter,
        adapter: args.adapter,
      });
    }

    // Per-item iteration cap: smaller of maxIterationsPerItem and
    // the global per-phase budget split across items.
    const perItemCap = Math.max(
      1,
      Math.min(
        maxIterationsPerItem,
        Math.ceil(maxIterationsPerPhase / items.length),
      ),
    );

    let cumulativeIterations = 0;
    let cumulativeCost = 0;
    let lastItemResult: LoopResult = {
      exitReason: "sentinel",
      iterations: 0,
      message: "No items to execute.",
    };

    for (const item of items) {
      const filesList = item.files
        .map((f) => `${f.path}${f.isNew ? " (CREATE)" : " (EDIT)"}`)
        .join(", ");
      const verify = item.verify?.trim() || "(no verify command declared)";

      // Structured handoff for strict executors (per the existing PRIME
      // system prompt). Each per-item prompt frames the work as a tight
      // single-file/single-test-list task.
      const itemPrompt =
        `You are executing ONE item of a multi-item phase. Complete only this item, mark its checkbox in ${phaseFile}, commit, and stop. Do not work on other items.\n\n` +
        `## Overall goal\n${goal}\n\n` +
        `## Constraints\n${constraints}\n\n` +
        `## Your item\n` +
        `- [ ] id: ${item.id}\n` +
        `  intent: ${item.intent}\n` +
        `  files: ${filesList || "(none declared)"}\n` +
        `  verify: ${verify}\n\n` +
        `## Structured context\n\n` +
        `Files you may touch (ONLY these):\n` +
        (item.files.length > 0
          ? item.files
              .map((f) => `  - ${f.path} (${f.isNew ? "CREATE" : "EDIT"})`)
              .join("\n")
          : "  (none declared — confine edits to the phase's natural scope)") +
        `\n\nVerify command (must exit 0):\n  - ${verify}\n\n` +
        `Non-goals:\n` +
        `  - Do NOT modify files outside the list above.\n` +
        `  - Do NOT work on items other than ${item.id}.\n\n` +
        `When done: mark the checkbox for item ${item.id} in ${phaseFile} as [x], commit, and emit the autopilot-done sentinel.`;

      const adapterName = args.adapter?.name as AdapterName | undefined;
      const cfgObj = args.config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const executionSpecifier = models?.execution as string | undefined;
      const executionModel = executionSpecifier
        ? resolveModel(executionSpecifier, adapterName ?? "opencode")
        : undefined;
      const itemResult = await args.runRalphLoop({
        prompt: itemPrompt,
        cwd: runCwd,
        agentName: "autopilot-fast",
        model: executionModel,
        maxIterations: perItemCap,
        ...(args.stallMs ? { stallMs: args.stallMs } : {}),
        config: args.config,
        agentOverrides: args.agentOverrides,
        laneId: useParallel ? laneId : undefined,
        logger: args.logger,
        emitter: args.emitter,
        adapter: args.adapter,
      });

      cumulativeIterations += itemResult.iterations;
      cumulativeCost += itemResult.cumulativeCostUsd ?? 0;
      lastItemResult = itemResult;

      // Re-read phase content to detect whether this item's checkbox
      // was actually marked — if not, fall through to the caller's
      // phaseComplete check, which will keep the phase open.
      let updatedContent: string;
      try {
        updatedContent = args.readFileSync(phasePath);
      } catch {
        updatedContent = phaseContent;
      }
      const updatedItems = parseItems(updatedContent);
      const matched = updatedItems.find((u) => u.id === item.id);
      if (matched && !matched.checked) {
        log.warn(
          { phase: phaseFile, itemId: item.id },
          "item completed iteration without marking its checkbox",
        );
      }

      if (!SUCCESS_REASONS.has(itemResult.exitReason)) {
        // Hard failure (struggle/stall/timeout/error/kill-switch) —
        // propagate so the caller's error path can soft-reset and
        // surface the phase as failed.
        return {
          ...itemResult,
          iterations: cumulativeIterations,
          cumulativeCostUsd: cumulativeCost,
          message: `Item ${item.id} failed: ${itemResult.message}`,
        };
      }

      // Per-item verify gate (after_item strategy, item 3.1).
      // When verify strategy is "after_item" (fast mode only), run the
      // item's verify command immediately. On failure, return early so
      // the phase retry can pick it up again (if verify_retry is enabled).
      if (args.verifyConfig?.strategy === "after_item" && item.verify?.trim()) {
        const itemVerifyResult = await _runVerifyCommands([item], runCwd, {
          timeoutMs: args.verifyConfig.timeoutMs,
        });
        if (itemVerifyResult.length > 0 && !itemVerifyResult[0].passed) {
          const failed = itemVerifyResult[0];
          log.warn(
            {
              phase: phaseFile,
              itemId: failed.itemId,
              command: failed.command,
              stderr: failed.stderr.slice(0, 500),
            },
            "per-item verify failed",
          );
          if (args.verifyConfig.retryOnFailure) {
            return {
              exitReason: "sentinel",
              iterations: cumulativeIterations,
              cumulativeCostUsd: cumulativeCost,
              message: `Item ${item.id} verify failed: ${failed.stderr.split("\n")[0]}`,
            };
          }
        }
      }
    }

    return {
      ...lastItemResult,
      iterations: cumulativeIterations,
      cumulativeCostUsd: cumulativeCost,
      message: `${items.length} items completed in ${cumulativeIterations} iterations`,
    };
  };

  /**
   * Run a single phase against a working directory. Used by both the
   * sequential and parallel paths. Sequential passes `opts.cwd`;
   * parallel passes a worktree path so concurrent phases don't trample
   * each other.
   *
   * Returns a structured PhaseResult. The function also updates the
   * session-level accumulators (`totalIterations`, `totalCostUsd`,
   * `laneCosts`, `lastResult`) directly.
   */
  const runPhaseInner = async (
    phaseFile: string,
    laneId: string,
    runCwd: string,
    retryContext?: string,
  ): Promise<PhaseResult & { phaseLoopResult: LoopResult; phaseComplete: boolean; verifyFailures?: string }> => {
    let verifyFailureSummary: string | undefined;
    const phasePath = useYamlSpec
      ? path.join(opts.planPath, "spec", phaseFile)
      : path.join(opts.planPath, phaseFile);
    const phaseContent = _readFileSync(phasePath);

    // Record HEAD before this phase so we can soft-reset on failure
    // (item 2.5). recordHead returns "HEAD" on git failure — we treat
    // that as a sentinel meaning "no recovery point captured".
    const preHeadSha = await recordHead(runCwd);

    log.info(
      { phase: phaseFile, lane: laneId, current: phasesCompleted + 1, total: uncheckedPhases.length },
      "starting phase",
    );

    // Emit typed phase:start event
    emitter?.emitEvent({
      type: "phase:start",
      timestamp: new Date().toISOString(),
      phase: phaseFile,
      laneId,
      current: phasesCompleted + 1,
      total: uncheckedPhases.length,
    });

    // Resolve phase-specific config (item 4.1) by deep-merging phase
    // overrides from config.phases.<phaseName> over the base config.
    // phaseName is the phase filename without extension.
    const phaseName = phaseFile.replace(/\.(md|ya?ml)$/, "");
    const phaseConfig = resolvePhaseConfig(
      opts.config as Record<string, unknown>,
      phaseName,
    );

    // Extract agent overrides from phase-specific config (item 4.2).
    // Prefer phase-specific agents, fall back to base config.
    const phaseAgentOverrides = (
      (phaseConfig.adapters as Record<string, unknown> | undefined)?.opencode?.agents ??
      ((opts.config as Record<string, unknown> | undefined)?.adapters as Record<string, unknown> | undefined)?.opencode?.agents
    ) as Record<string, Record<string, unknown>> | undefined;

    // Per-item execution path (item 4.8). When --fast is set the
    // resolved tier is `autopilot-execute` (mid-tier executor model).
    // Strict executors do better with one item at a time: send a
    // tightly-scoped prompt for each unchecked item, mark its checkbox
    // when done, move to the next. Deep models stay on the per-phase
    // path — they handle multi-item phases fine and the per-item
    // overhead would be wasted spawn cost.
    let result: LoopResult;
    const phaseVerifyConfig = extractVerifyConfig(phaseConfig);
    if (opts.fast) {
      result = await runItemsForPhase({
        phaseFile,
        phasePath,
        laneId,
        runCwd,
        runRalphLoop: _runRalphLoop,
        readFileSync: _readFileSync,
        useParallel,
        stallMs,
        logger: opts.logger,
        emitter,
        adapter: opts.adapter,
        config: opts.config,
        agentOverrides: phaseAgentOverrides,
        verifyConfig: phaseVerifyConfig,
      });
    } else {
      const retrySection = retryContext
        ? `\n\n## Previous attempt failed\nThe previous attempt at this phase failed verification. Here's what went wrong:\n${retryContext}\n\nFix these failures before marking items as complete.\n`
        : "";
      const prompt =
        `You are executing one phase of a multi-file plan. Work through every unchecked item in order. Check each box as you complete it. Commit when the phase is done.\n\n` +
        `## Overall goal\n${goal}\n\n` +
        `## Constraints\n${constraints}\n\n` +
        `## Your phase (${phaseFile})\n${phaseContent}\n` +
        retrySection +
        `\nDo not work on items from other phases. Do not ask questions — pick sensible defaults and note decisions in ## Open questions.`;

      const adapterName = opts.adapter?.name as AdapterName | undefined;
      const cfgObj = opts.config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const executionSpecifier = models?.execution as string | undefined;
      const executionModel = executionSpecifier
        ? resolveModel(executionSpecifier, adapterName ?? "opencode")
        : undefined;
      result = await _runRalphLoop({
        prompt,
        cwd: runCwd,
        agentName: undefined,
        model: executionModel,
        maxIterations: maxIterationsPerPhase,
        stallMs,
        config: opts.config,
        agentOverrides: phaseAgentOverrides,
        laneId: useParallel ? laneId : undefined,
        logger: opts.logger,
        emitter,
        adapter: opts.adapter,
      });
    }
    totalIterations += result.iterations;
    const costThisPhase = result.cumulativeCostUsd ?? 0;
    totalCostUsd += costThisPhase;
    laneCosts.set(laneId, (laneCosts.get(laneId) ?? 0) + costThisPhase);
    lastResult = result;

    // Phase plan files live under opts.planPath regardless of where the
    // agent was running. The agent edits the phase file in-place via
    // its checkout — for the sequential path opts.cwd === runCwd, for
    // the parallel path the phase file resolves the same way (worktrees
    // share the same docs/ tree until the agent commits).
    const updatedPhaseContent = _readFileSync(phasePath);
    let phaseComplete = useYamlSpec
      ? (() => {
          const yamlItems = parseSpecItems(phasePath);
          return yamlItems.length > 0 && yamlItems.every((i) => i.checked);
        })()
      : isPhaseComplete(updatedPhaseContent);

    // Post-phase test gate (item 4.1). When verify strategy is "skip",
    // bypass this entirely. When "after_item" in fast mode, verify
    // already ran per-item. When "after_phase" (default), run each item's
    // `verify:` command now. Any failure downgrades `phaseComplete` to false
    // so the checkbox in main.md is NOT marked — the failure surfaces in the
    // debrief and (for fast-tier soft-failure mode) the next iteration
    // can pick the phase up again. Items without a `verify:` field are
    // simply skipped.
    const verifyConfig = extractVerifyConfig(opts.config);
    const shouldSkipVerify = verifyConfig.strategy === "skip";
    const isAfterItemMode = verifyConfig.strategy === "after_item" && opts.fast;

    if (phaseComplete && !shouldSkipVerify && !isAfterItemMode) {
      const items = useYamlSpec
        ? parseSpecItems(phasePath)
        : parseItems(updatedPhaseContent);
      const itemsWithVerify = items.filter((it) => it.verify?.trim());
      if (itemsWithVerify.length > 0) {
        log.info(
          { phase: phaseFile, count: itemsWithVerify.length },
          "running verify commands",
        );
        // Emit typed verify:start event
        emitter?.emitEvent({
          type: "verify:start",
          timestamp: new Date().toISOString(),
          phase: phaseFile,
          itemCount: itemsWithVerify.length,
        });
        const phaseVerify = await _runVerifyCommands(itemsWithVerify, runCwd, {
          timeoutMs: verifyConfig.timeoutMs,
        });
        verifyResults.push({ phaseFile, results: phaseVerify });
        const failed = phaseVerify.filter((r) => !r.passed);
        // Emit typed verify:result events
        for (const r of phaseVerify) {
          emitter?.emitEvent({
            type: "verify:result",
            timestamp: new Date().toISOString(),
            phase: phaseFile,
            itemId: r.itemId,
            command: r.command,
            passed: r.passed,
            ...(r.stderr ? { stderr: r.stderr.slice(0, 500) } : {}),
          });
        }
        if (failed.length > 0) {
          for (const f of failed) {
            log.warn(
              {
                phase: phaseFile,
                itemId: f.itemId,
                command: f.command,
                stderr: f.stderr.slice(0, 500),
              },
              "verify command failed",
            );
          }
          phaseComplete = false;
          // Build a summary of failures for retry context
          verifyFailureSummary = failed
            .map((f) => `- \`${f.command}\` failed (item ${f.itemId}): ${f.stderr.split("\n").slice(-3).join(" ").slice(0, 200)}`)
            .join("\n");
        } else {
          log.info(
            { phase: phaseFile, passed: phaseVerify.length },
            "all verify commands passed",
          );
        }
        // Emit typed verify:done event
        emitter?.emitEvent({
          type: "verify:done",
          timestamp: new Date().toISOString(),
          phase: phaseFile,
          passed: phaseVerify.filter((r) => r.passed).length,
          failed: failed.length,
        });
      }
    }

    if (!phaseComplete && !SUCCESS_REASONS.has(result.exitReason)) {
      log.warn({ phase: phaseFile, exitReason: result.exitReason }, "phase failed");
      const rollbackConfig = (cfgObj?.rollback_on_failure as string | undefined) ?? "soft";
      if (rollbackConfig !== "off" && opts.fast && preHeadSha && preHeadSha !== "HEAD") {
        const ok = await resetSoft(runCwd, preHeadSha, {
          onWarn: (m) => log.warn(m),
        });
        if (ok) {
          log.info({ ref: preHeadSha.slice(0, 8) }, "soft-reset to pre-phase state");
        }
      } else if (rollbackConfig === "off" && opts.fast && preHeadSha && preHeadSha !== "HEAD") {
        log.info({ ref: preHeadSha.slice(0, 8) }, "rollback disabled by config — keeping phase changes");
      }
      // Emit typed phase:done event (failed)
      emitter?.emitEvent({
        type: "phase:done",
        timestamp: new Date().toISOString(),
        phase: phaseFile,
        laneId,
        completed: false,
        iterations: result.iterations,
        costUsd: costThisPhase,
      });
      // Run on_error hook (item 3.3, 4.3) — phase-level hook overrides plan-level.
      // Fire-and-forget (errors swallowed).
      const phaseHooksConfig = extractHooksConfig(phaseConfig);
      const effectiveOnErrorHook = phaseHooksConfig.on_error ?? hooksConfig.on_error;
      if (effectiveOnErrorHook) {
        runHook(effectiveOnErrorHook, runCwd, verifyConfig.timeoutMs).catch(() => {});
      }
      return {
        phaseFile,
        laneId,
        ok: false,
        fatal: true,
        iterations: result.iterations,
        costUsd: costThisPhase,
        phaseLoopResult: result,
        phaseComplete: false,
      };
    }

    if (!phaseComplete && result.exitReason === "max-iterations") {
      log.warn(
        { phase: phaseFile, max: maxIterationsPerPhase },
        "phase budget exhausted — moving on",
      );
      const checkpointEnabled = cfgObj?.checkpoint !== false;
      if (checkpointEnabled) {
        writeCheckpoint(opts.cwd, {
          planPath: opts.planPath,
          completedPhases: [...completedPhasesAcc],
          totalCostUsd,
          totalIterations,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Emit typed phase:done event (success or soft-failure)
    emitter?.emitEvent({
      type: "phase:done",
      timestamp: new Date().toISOString(),
      phase: phaseFile,
      laneId,
      completed: phaseComplete,
      iterations: result.iterations,
      costUsd: costThisPhase,
    });

    return {
      phaseFile,
      laneId,
      ok: phaseComplete,
      fatal: false,
      iterations: result.iterations,
      costUsd: costThisPhase,
      phaseLoopResult: result,
      phaseComplete,
      verifyFailures: verifyFailureSummary,
    };
  };

  /**
   * Mark a phase as completed: bump counters, push to the accumulator,
   * update main.md's checkbox, and persist a checkpoint. Used by both
   * paths after a phase reports `phaseComplete === true`.
   *
   * Accepts optional phaseHooksConfig for per-phase hook overrides (item 4.3).
   * When provided, phase-level hooks override plan-level hooks.
   */
  const recordPhaseCompletion = async (
    phaseFile: string,
    result: LoopResult,
    phaseHooksConfig?: ReturnType<typeof extractHooksConfig>,
  ) => {
    phasesCompleted++;
    completedPhasesAcc.push(phaseFile);
    if (useYamlSpec) {
      // YAML path: update spec/main.yaml's completed field
      specMarkPhaseCompleted(opts.planPath, phaseFile);
    } else {
      // Markdown path: update main.md's checkbox
      const updatedMain = markPhaseChecked(_readFileSync(mainMdPath), phaseFile);
      _writeFileSync(mainMdPath, updatedMain);
    }
    const checkpointEnabled = cfgObj?.checkpoint !== false;
    if (checkpointEnabled) {
      writeCheckpoint(opts.cwd, {
        planPath: opts.planPath,
        completedPhases: [...completedPhasesAcc],
        totalCostUsd,
        totalIterations,
        timestamp: new Date().toISOString(),
      });
    }
    log.info(
      {
        phase: phaseFile,
        completed: phasesCompleted,
        total: uncheckedPhases.length,
        iterations: result.iterations,
        cost: (result.cumulativeCostUsd ?? 0).toFixed(2),
      },
      "phase complete",
    );
    // Run post_phase hook (item 3.3, 4.3) — phase-level hook overrides plan-level.
    // On failure, log warn but don't mark phase incomplete.
    const effectivePostPhaseHook = phaseHooksConfig?.post_phase ?? hooksConfig.post_phase;
    if (effectivePostPhaseHook) {
      const hookResult = await runHook(effectivePostPhaseHook, opts.cwd, verifyConfig.timeoutMs);
      if (!hookResult.ok) {
        log.warn({ phase: phaseFile, output: hookResult.output }, "post_phase hook failed");
      }
    }
  };

  // ---------------------------------------------------------------------
  // Sequential path (item 3.7): preserves the original semantics. Used
  // when --parallel <= 1 OR no parallelism is possible. NO worktree
  // creation, NO merge step.
  // ---------------------------------------------------------------------
  if (!useParallel) {
    for (const phaseFile of uncheckedPhases) {
      // Check abort signal at phase boundaries (graceful shutdown via TUI Ctrl+C)
      if (opts.signal?.aborted) {
        log.info({ completed: phasesCompleted, remaining: uncheckedPhases.length }, "abort signal received — writing checkpoint and stopping");
        const checkpointEnabled = cfgObj?.checkpoint !== false;
        if (checkpointEnabled) {
          writeCheckpoint(opts.cwd, {
            planPath: opts.planPath,
            completedPhases: [...completedPhasesAcc],
            totalCostUsd,
            totalIterations,
            timestamp: new Date().toISOString(),
          });
        }
        return {
          exitReason: "aborted",
          iterations: totalIterations,
          cumulativeCostUsd: totalCostUsd,
          message: `Aborted after ${phasesCompleted}/${uncheckedPhases.length} phases completed`,
        };
      }

      // Resolve phase config once, before retry loop (item 4.1, 4.3).
      // Phase-level hooks are extracted from this config and used at all hook call sites.
      const phaseName = phaseFile.replace(/\.(md|ya?ml)$/, "");
      const phaseConfig = resolvePhaseConfig(
        opts.config as Record<string, unknown>,
        phaseName,
      );
      const phaseHooksConfig = extractHooksConfig(phaseConfig);

      // Retry loop: re-run the phase when verify fails (up to N attempts, configurable).
      // Default 3 retries in production; 1 (no retry) when test deps are injected.
      // On the final retry, escalate to the deep model (Opus) for self-healing.
      // When config.verify_retry is false, disable retries entirely (single attempt).
      const verifyRetryConfig = extractVerifyConfig(opts.config);
      const effectiveMaxRetries = verifyRetryConfig.retryOnFailure
        ? (opts.maxPhaseRetries ?? (opts._deps ? 1 : 3))
        : 1;
      let attempt = 0;
      let phaseSuccess = false;
      let lastVerifyFailures: string | undefined;

      while (attempt < effectiveMaxRetries && !phaseSuccess) {
        attempt++;
        const isEscalation = attempt === effectiveMaxRetries && attempt > 1 && opts.fast;

        if (attempt > 1) {
          log.info(
            { phase: phaseFile, attempt, escalate: isEscalation },
            isEscalation ? "escalating to deep model for retry" : "retrying phase after verify failure",
          );
          emitter?.emitEvent({
            type: "phase:start",
            timestamp: new Date().toISOString(),
            phase: `${phaseFile} (${isEscalation ? "escalation" : `retry ${attempt - 1}`})`,
            laneId: "lane-1",
            current: phasesCompleted + 1,
            total: uncheckedPhases.length,
          });
        }

        // On escalation, temporarily override opts.fast so runPhaseInner
        // uses the deep agent (Opus) instead of the fast executor (GLM-5).
        const originalFast = opts.fast;
        if (isEscalation) {
          (opts as any).fast = false;
        }

        // Run pre_phase hook (item 3.3, 4.3) — phase-level hooks override plan-level hooks.
        const effectivePrePhaseHook = phaseHooksConfig.pre_phase ?? hooksConfig.pre_phase;
        if (effectivePrePhaseHook) {
          const hookResult = await runHook(effectivePrePhaseHook, opts.cwd, verifyConfig.timeoutMs);
          if (!hookResult.ok) {
            log.warn({ phase: phaseFile, output: hookResult.output }, "pre_phase hook failed — skipping phase");
            if (isEscalation) {
              (opts as any).fast = originalFast;
            }
            // Skip this phase and move to the next
            phaseSuccess = false;
            continue;
          }
        }

        const r = await runPhaseInner(phaseFile, "lane-1", opts.cwd, lastVerifyFailures);

        if (isEscalation) {
          (opts as any).fast = originalFast;
        }

        // Capture verify failures for next retry's context
        lastVerifyFailures = r.verifyFailures;

        if (r.phaseComplete) {
          await recordPhaseCompletion(phaseFile, r.phaseLoopResult, phaseHooksConfig);
          phaseSuccess = true;
          break;
        }

        if (r.fatal) {
          return {
            ...r.phaseLoopResult,
            iterations: totalIterations,
            cumulativeCostUsd: totalCostUsd,
            message: `${r.phaseLoopResult.message} (phase ${phaseFile}, ${phasesCompleted}/${uncheckedPhases.length} phases completed, total $${totalCostUsd.toFixed(2)})`,
          };
        }

        // Phase didn't complete (verify failed) — retry unless exhausted
        if (attempt >= effectiveMaxRetries) {
          log.warn({ phase: phaseFile, attempts: attempt }, "phase exhausted retries — moving on");
        }
      }
    }
  } else {
    // -------------------------------------------------------------------
    // Parallel path (items 3.2 + 3.3 + 3.6). Each phase runs in its own
    // worktree branched from HEAD. On phaseComplete the branch is merged
    // back with --no-ff and the worktree is removed. Merge conflicts —
    // which shouldn't happen if 3.1's conflict-graph is correct — leave
    // the worktree on disk and the path is surfaced in `orphanedWorktrees`.
    // -------------------------------------------------------------------
    const handles = new Map<string, WorktreeHandle>();
    const wtLogger = {
      warn: (obj: unknown, msg?: string) => log.warn(obj as object, msg),
      info: (obj: unknown, msg?: string) => log.info(obj as object, msg),
    };

    // Synchronous cleanup hook for force-exit paths (item 3.6 + 2.4).
    // The async `try/finally` below covers the graceful path (normal
    // completion, single-SIGINT abort flow). When loop.ts's signal
    // handler force-exits via `process.exit(130)` on the second signal,
    // async cleanup never runs — so we register an `exit` listener that
    // synchronously invokes `git worktree remove --force` for each live
    // handle. This is best-effort: a kill -9 still leaks worktrees, but
    // SIGINT/SIGTERM force-exits are cleaned up before the process dies.
    const { execFileSync } = await import("node:child_process");
    const exitCleanup = () => {
      for (const handle of handles.values()) {
        try {
          execFileSync("git", ["worktree", "remove", "--force", handle.path], {
            cwd: opts.cwd,
            stdio: "ignore",
          });
        } catch {
          // best-effort
        }
        try {
          execFileSync("git", ["branch", "-D", handle.branch], {
            cwd: opts.cwd,
            stdio: "ignore",
          });
        } catch {
          // best-effort
        }
      }
    };
    process.on("exit", exitCleanup);

    try {
      const lanesResult = await runLanes({
        phases: uncheckedPhases,
        conflictGraph,
        laneCount: requestedLanes,
        logger: wtLogger,
        runPhase: async (phaseFile, laneId) => {
          // Slug used for branch + worktree-path naming. Strip .md and
          // sanitize for shell safety.
          const slug = phaseFile.replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");

          let handle: WorktreeHandle | null = null;
          try {
            handle = await createWorktree(opts.cwd, {
              laneSlug: `${slug}-${laneId}`,
              logger: wtLogger,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn({ phase: phaseFile, err: msg }, "worktree create failed — falling back to main cwd");
          }

          const runCwd = handle?.path ?? opts.cwd;
          // Run pre_phase hook (item 3.3, 4.3) — resolve phase config and use
          // phase-level hooks which override plan-level hooks.
          const phaseName = phaseFile.replace(/\.(md|ya?ml)$/, "");
          const phaseConfig = resolvePhaseConfig(
            opts.config as Record<string, unknown>,
            phaseName,
          );
          const phaseHooksConfig = extractHooksConfig(phaseConfig);
          const effectivePrePhaseHook = phaseHooksConfig.pre_phase ?? hooksConfig.pre_phase;
          if (effectivePrePhaseHook) {
            const hookResult = await runHook(effectivePrePhaseHook, runCwd, verifyConfig.timeoutMs);
            if (!hookResult.ok) {
              log.warn({ phase: phaseFile, output: hookResult.output }, "pre_phase hook failed — skipping phase");
              // Return a skipped-phase result so runLanes can move on
              return {
                phaseFile,
                laneId,
                ok: false,
                fatal: false,
                iterations: 0,
                costUsd: 0,
                phaseLoopResult: {
                  exitReason: "error" as const,
                  iterations: 0,
                  message: "pre_phase hook failed",
                },
                phaseComplete: false,
              };
            }
          }
          const result = await runPhaseInner(phaseFile, laneId, runCwd);

          if (handle) {
            handles.set(phaseFile, handle);

            if (result.phaseComplete) {
              const merge = await mergeWorktree(opts.cwd, { branch: handle.branch });
              if (merge.ok) {
                await handle.cleanup().catch(() => {});
                handles.delete(phaseFile);
              } else {
                log.warn(
                  { phase: phaseFile, conflicts: merge.conflicts, path: handle.path },
                  "merge failed — worktree left on disk for manual resolution",
                );
                orphanedWorktrees.push(handle.path);
                return { ...result, ok: false, fatal: true };
              }
            } else {
              await handle.cleanup().catch(() => {});
              handles.delete(phaseFile);
            }
          }

          return result;
        },
      });

      for (const r of lanesResult.results) {
        if (r.ok) {
          // recordPhaseCompletion needs the LoopResult — but the
          // PhaseResult only carries cost/iterations summaries. Synthesize
          // a minimal LoopResult so the log line shape is consistent.
          // Resolve phase-specific hooks for per-phase post_phase hook override (item 4.3).
          const phaseName = r.phaseFile.replace(/\.(md|ya?ml)$/, "");
          const phaseConfig = resolvePhaseConfig(
            opts.config as Record<string, unknown>,
            phaseName,
          );
          const phaseHooksConfig = extractHooksConfig(phaseConfig);
          await recordPhaseCompletion(r.phaseFile, {
            exitReason: "sentinel",
            iterations: r.iterations,
            message: "completed via parallel lane",
            cumulativeCostUsd: r.costUsd,
          }, phaseHooksConfig);
        }
      }

      const fatalResult = lanesResult.results.find((r) => r.fatal);
      if (fatalResult) {
        return {
          ...lastResult,
          iterations: totalIterations,
          cumulativeCostUsd: totalCostUsd,
          laneCosts,
          ...(orphanedWorktrees.length > 0 ? { orphanedWorktrees } : {}),
          ...(verifyResults.length > 0 ? { verifyResults } : {}),
          message: `${lastResult.message} (phase ${fatalResult.phaseFile}, ${phasesCompleted}/${uncheckedPhases.length} phases completed, total $${totalCostUsd.toFixed(2)})`,
        };
      }
    } finally {
      // Best-effort cleanup of any handles still alive — the
      // orchestrator may have thrown mid-flight, or a SIGINT may have
      // aborted scheduling before the per-phase cleanup ran.
      for (const [phaseFile, handle] of handles) {
        await handle.cleanup().catch((err) => {
          log.warn(
            { phase: phaseFile, err: err instanceof Error ? err.message : String(err) },
            "worktree cleanup failed",
          );
        });
      }
      // Remove the synchronous exit listener — graceful path completed.
      process.removeListener("exit", exitCleanup);
    }
  }

  // All phases done. Now execute main.md's own cross-cutting acceptance
  // criteria (items like x1, x2, etc. that aren't in any phase file).
  // YAML specs don't have cross-cutting items in main.md (they'd be in
  // the spec's items array), and main.md may not exist at all for a
  // YAML-only plan — skip this block to avoid ENOENT.
  if (!useYamlSpec) {
    const finalMainContent = _readFileSync(mainMdPath);
    const mainHasUnchecked = /^- \[ \]\s+id:/m.test(finalMainContent);

    if (mainHasUnchecked) {
      log.info("starting cross-cutting items");
      const crossCuttingPrompt =
        `You are executing the cross-cutting acceptance criteria from a multi-file plan's main.md. All phase files are complete. Work through every unchecked item (id: x1, x2, etc.) in main.md. Check each box as you complete it. Commit when done.\n\n` +
        `## Overall goal\n${goal}\n\n` +
        `## Constraints\n${constraints}\n\n` +
        `## main.md\n${finalMainContent}\n\n` +
        `Only work on the unchecked items in main.md's acceptance criteria. Phase items are already done. Do not ask questions.`;

      const adapterName = opts.adapter?.name as AdapterName | undefined;
      const cfgObj = opts.config as Record<string, unknown> | undefined;
      const models = cfgObj?.models as Record<string, unknown> | undefined;
      const executionSpecifier = models?.execution as string | undefined;
      const executionModel = executionSpecifier
        ? resolveModel(executionSpecifier, adapterName ?? "opencode")
        : undefined;
      const crossCuttingAgentOverrides = (
        (opts.config as Record<string, unknown> | undefined)?.adapters as Record<string, unknown> | undefined
      )?.opencode?.agents as Record<string, Record<string, unknown>> | undefined;
      const crossResult = await _runRalphLoop({
        prompt: crossCuttingPrompt,
        cwd: opts.cwd,
        agentName: opts.fast ? "autopilot-fast" : undefined,
        model: executionModel,
        stallMs,
        config: opts.config,
        agentOverrides: crossCuttingAgentOverrides,
        logger: opts.logger,
        emitter,
        adapter: opts.adapter,
      });
      totalIterations += crossResult.iterations;
      totalCostUsd += crossResult.cumulativeCostUsd ?? 0;
      lastResult = crossResult;
    }
  }

  log.info({ completed: phasesCompleted, total: uncheckedPhases.length, iterations: totalIterations, cost: totalCostUsd.toFixed(2) }, "all phases done");

  // Run post_run hook (item 3.3) — on failure, log warn but don't block
  if (hooksConfig.post_run) {
    const hookResult = await runHook(hooksConfig.post_run, opts.cwd, verifyConfig.timeoutMs);
    if (!hookResult.ok) {
      log.warn({ output: hookResult.output }, "post_run hook failed");
    }
  }

  // Run completed successfully — delete the checkpoint so the next
  // invocation against this plan starts clean.
  deleteCheckpoint(opts.cwd);

  // Automatic changeset generation (item 3.4). Skipped when running
  // under test deps (in-memory paths can't host a .changeset/ dir) or
  // when config.changeset is explicitly false. Best-effort — failures
  // emit a warning but don't poison the run.
  let changesetPath: string | undefined;
  const changesetEnabled = cfgObj?.changeset !== false;
  if (
    changesetEnabled &&
    !opts._deps &&
    phasesCompleted === uncheckedPhases.length &&
    uncheckedPhases.length > 0
  ) {
    try {
      const { generateChangeset } = await import("./changeset-generator.js");
      const changesetOpts = {
        packageName: cfgObj?.changeset_package as string | undefined,
        bumpLevel: cfgObj?.changeset_bump as string | undefined,
      };
      const cs = await generateChangeset(opts.planPath, opts.cwd, changesetOpts);
      changesetPath = cs.path;
      log.info(
        { path: cs.path, bumpLevel: cs.bumpLevel },
        "changeset generated",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "changeset generation failed");
    }
  }

  // Auto-ship (item 4.7). Gated behind --ship; when off, just print a
  // hint that the run is ready for manual /ship. When on, push branch
  // and open a PR against the default branch.
  let prUrl: string | undefined;
  if (
    !opts._deps &&
    opts.ship &&
    phasesCompleted === uncheckedPhases.length &&
    uncheckedPhases.length > 0
  ) {
    try {
      const { autoShip } = await import("./auto-ship.js");
      const shipResult = await autoShip({
        planPath: opts.planPath,
        repoRoot: opts.cwd,
      });
      prUrl = shipResult.prUrl;
      log.info({ prUrl }, "PR opened");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, "auto-ship failed — run /ship to finalize manually");
    }
  } else if (
    !opts._deps &&
    !opts.ship &&
    phasesCompleted === uncheckedPhases.length &&
    uncheckedPhases.length > 0
  ) {
    log.info("all phases complete, run `/ship` to finalize");
  }

  return {
    ...lastResult,
    iterations: totalIterations,
    cumulativeCostUsd: totalCostUsd,
    // Per-lane breakdown (item 3.5) — only included when more than one
    // lane was used so sequential runs don't see noise in the debrief.
    ...(laneCosts.size > 1 ? { laneCosts } : {}),
    // Surviving worktrees (item 3.6) — surfaced for manual cleanup.
    ...(orphanedWorktrees.length > 0 ? { orphanedWorktrees } : {}),
    // Per-phase verify results (item 4.1) — surfaced for the debrief.
    ...(verifyResults.length > 0 ? { verifyResults } : {}),
    // Changeset path (item 4.6) and PR url (item 4.7).
    ...(changesetPath ? { changesetPath } : {}),
    ...(prUrl ? { prUrl } : {}),
    message:
      (prUrl
        ? `${phasesCompleted}/${uncheckedPhases.length} phases completed in ${totalIterations} iterations, total $${totalCostUsd.toFixed(2)}, PR: ${prUrl}`
        : `${phasesCompleted}/${uncheckedPhases.length} phases completed in ${totalIterations} iterations, total $${totalCostUsd.toFixed(2)}`),
  };
}
