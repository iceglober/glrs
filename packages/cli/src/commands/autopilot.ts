/**
 * `glrs autopilot` — Interactive three-phase autopilot orchestrator.
 *
 * --plan / -p <path>: use an existing plan at this path.
 * --status: read and pretty-print the current autopilot status from .agent/autopilot-events.jsonl.
 *
 * When no --plan is given, opens an interactive file picker.
 * When a plan is provided and has checkboxes, skips scoping/planning and executes directly.
 *
 * Plans are always enriched before execution (idempotent — already-enriched plans skip).
 * Execution is always per-item with the mid-execute tier, escalating to deep on retry exhaustion.
 *
 * This is a thin wrapper: parse args → create SessionRunner → attach CLI renderer → run.
 */

import { command, flag, option, optional, string as stringType, number as numberType, oneOf } from "cmd-ts";
import * as path from "node:path";
import * as fs from "node:fs";
import { formatElapsed, formatCost, EventStreamReader, deriveState, applyCLIOverrides, isSuccessExitReason, validatePlan, detectSpecPhases, parseSpecItems } from "@glrs-dev/autopilot";
import { SessionRunner } from "@glrs-dev/autopilot";
import { createCliRenderer } from "../cli-renderer.js";
import { track, flushAnalytics } from "../lib/analytics.js";
import { createAdapter, ADAPTER_NAMES, DEFAULT_ADAPTER } from "../adapter-factory.js";
import { resolveConfig } from "../autopilot/config-reader.js";
import type { AutopilotConfig } from "../autopilot/autopilot-config.js";
import type { SessionResult } from "@glrs-dev/autopilot";

// ---------------------------------------------------------------------------
// Summary renderer — extracted for unit-testability (a3)
// ---------------------------------------------------------------------------

export interface SummaryOutput {
  stdout: string;
  exitCode: number;
}

/**
 * Render the autopilot completion summary for a given session result.
 *
 * Three buckets:
 *   - success (sentinel, max-iterations) → ✓ header, exit 0
 *   - neutral (kill-switch) → ◼ header, exit 0
 *   - failure (error, struggle, stall, timeout, aborted) → ✗ header, exit 1
 *
 * When `loopResult.message` is non-empty, a `Reason: <message>` line is
 * printed after the `Result:` line. When empty/undefined, it is suppressed.
 */
export function renderSummary(result: SessionResult): SummaryOutput {
  const { exitReason, iterations, message, cumulativeCostUsd } = result.loopResult;
  const costStr = cumulativeCostUsd ? ` · $${cumulativeCostUsd.toFixed(2)}` : "";

  const success = isSuccessExitReason(exitReason);
  const killed = exitReason === "kill-switch";
  const failed = !success && !killed;

  let header: string;
  if (success) {
    header = `\x1b[1m✓ Autopilot complete\x1b[0m`;
  } else if (killed) {
    header = `\x1b[33m◼ Autopilot stopped (kill switch)\x1b[0m`;
  } else {
    header = `\x1b[1;31m✗ Autopilot failed\x1b[0m`;
  }

  const reasonLine = message && message.trim()
    ? `  Reason: ${message}\n`
    : "";

  const stdout =
    `\n${header}\n` +
    `  Plan:   ${result.planPath}\n` +
    `  Result: ${exitReason} after ${iterations} iteration(s)${costStr}\n` +
    reasonLine +
    `\n`;

  return { stdout, exitCode: failed ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Pre-flight validation — extracted for unit-testability (Bug A fix)
// ---------------------------------------------------------------------------

export interface PreflightResult {
  /** true when stale spec/ was detected and deleted; caller should print the announcement */
  recovered: boolean;
  /** non-null when validation failed and is not recoverable; caller should exit with this code */
  exitCode: number | null;
  /** validation errors to print when exitCode is non-null */
  errors: Array<{ message: string; file?: string }>;
  /** validation warnings to print regardless */
  warnings: Array<{ message: string; file?: string }>;
}

/**
 * Run pre-flight plan validation and attempt auto-recovery from stale spec/.
 *
 * Returns:
 *   - `{ recovered: false, exitCode: null }` → validation passed, continue
 *   - `{ recovered: true, exitCode: null }` → stale spec/ deleted; caller prints announcement
 *   - `{ recovered: false, exitCode: 1 }` → validation failed, not recoverable; caller exits 1
 *
 * Recovery conditions (all must hold):
 *   1. `resume` is false (never blow away resume state)
 *   2. Every error has code `missing-spec-phase-file`
 *   3. No existing phase YAML has any `checked: true` item (safety guard)
 *
 * Mirrors the in-`enrichPlan` stale-spec recovery safety semantics exactly.
 */
export function runPreflightValidation(
  planPath: string,
  resume: boolean,
): PreflightResult {
  const validation = validatePlan(planPath);

  const warnings = validation.warnings.map((w) => ({ message: w.message, file: w.file }));

  if (validation.errors.length === 0) {
    return { recovered: false, exitCode: null, errors: [], warnings };
  }

  const enrichmentCodes = new Set(["requires-enrichment", "missing-spec"]);
  if (validation.errors.every((e) => enrichmentCodes.has(e.code))) {
    return { recovered: false, exitCode: null, errors: [], warnings };
  }

  // Attempt auto-recovery when:
  //   1. Not resuming
  //   2. All errors are missing-spec-phase-file
  //   3. No existing phase YAML has checked items
  const canAttemptRecovery =
    !resume &&
    validation.errors.every((e) => e.code === "missing-spec-phase-file");

  if (canAttemptRecovery) {
    const referencedPhases = detectSpecPhases(planPath);
    const hasChecked = referencedPhases.some((p) => {
      const pp = path.join(planPath, "spec", p);
      if (!fs.existsSync(pp)) return false;
      return parseSpecItems(pp).some((it) => it.checked);
    });

    if (!hasChecked) {
      fs.rmSync(path.join(planPath, "spec"), { recursive: true, force: true });
      return { recovered: true, exitCode: null, errors: [], warnings };
    }
  }

  const errors = validation.errors.map((e) => ({ message: e.message, file: e.file }));
  return { recovered: false, exitCode: 1, errors, warnings };
}

export const autopilotInteractiveCmd = command({
  name: "autopilot",
  description:
    "Run the autopilot. Use -p <path> to provide a plan, or omit to pick one interactively. Use --status to check the current run status.",
  args: {
    plan: option({
      long: "plan",
      short: "p",
      type: optional(stringType),
      description:
        "Path to an existing plan file or directory. If omitted, opens an interactive file picker.",
    }),
    resume: flag({
      long: "resume",
      description:
        "Resume a prior run: skip phases marked completed in spec/main.yaml and items already checked in spec/<phase>.yaml.",
    }),
    maxIterationsPerPhase: option({
      long: "max-iterations-per-phase",
      type: optional(numberType),
      description:
        "Per-phase iteration budget (default: 25). A phase that hits this budget without completing is treated as a soft failure: a checkpoint is written, a warning is logged, and the run continues to the next phase.",
    }),
    parallel: option({
      long: "parallel",
      type: optional(numberType),
      description:
        "Number of parallel lanes for phase execution (default: 1 = sequential). When >1, phases that touch disjoint files run concurrently in per-lane git worktrees, merged back on completion. Conflicting phases (sharing any file) still run sequentially. The orchestrator falls back to the sequential path when no parallelism is possible (every phase shares a file).",
    }),
    ship: flag({
      long: "ship",
      description:
        "After all phases complete and verify passes, push the current branch and open a PR via `gh pr create`. Without this flag, the autopilot stops at \"all phases complete, run `/ship` to finalize.\" The PR title is the plan's H1; the PR body is main.md verbatim. Refuses to push from main/master/detached HEAD.",
    }),
    status: flag({
      long: "status",
      description:
        "Read and pretty-print the current autopilot status from .agent/autopilot-status.json. Exits 0 if found, 1 if not running.",
    }),
    adapter: option({
      long: "adapter",
      short: "a",
      type: optional(oneOf(ADAPTER_NAMES as unknown as string[])),
      description: `Agent adapter to use (default: ${DEFAULT_ADAPTER}). Available: ${ADAPTER_NAMES.join(", ")}`,
    }),
    target: option({
      long: "target",
      short: "t",
      type: optional(oneOf(ADAPTER_NAMES as unknown as string[])),
      description: `Alias for --adapter.`,
    }),
  },
  handler: async ({ plan, resume, maxIterationsPerPhase, parallel, ship, status, adapter, target }) => {
    const adapterName = adapter ?? target;
    const cwd = process.cwd();

    // --status: short-circuit — read and pretty-print the current session state
    if (status) {
      const eventFilePath = path.join(cwd, ".agent", "autopilot-events.jsonl");
      const legacyStatusFilePath = path.join(cwd, ".agent", "autopilot-status.json");

      // Primary: read from event stream
      if (fs.existsSync(eventFilePath)) {
        try {
          const reader = new EventStreamReader(eventFilePath);
          const events = reader.readAll();
          const handle = deriveState(events);

          if (!handle) {
            process.stderr.write("Event stream found but contains no session:start event.\n");
            process.exit(1);
          }

          const elapsedMs = Date.now() - new Date(handle.startedAt).getTime();
          const elapsed = formatElapsed(elapsedMs);
          const cost = formatCost(handle.cost, false);

          process.stdout.write("\n\x1b[1mAutopilot Status\x1b[0m\n\n");
          process.stdout.write(`  Plan:       ${handle.planPath}\n`);
          process.stdout.write(`  Status:     ${handle.status}\n`);
          process.stdout.write(`  Elapsed:    ${elapsed}\n`);
          process.stdout.write(`  Iterations: ${handle.totalIterations} completed\n`);
          process.stdout.write(`  Cost:       ${cost}\n`);
          if (handle.currentPhase) {
            process.stdout.write(`  Phase:      ${handle.currentPhase.phase} (${handle.currentPhase.current}/${handle.currentPhase.total})\n`);
          }
          if (handle.currentIteration) {
            process.stdout.write(`  Iteration:  ${handle.currentIteration.iteration}/${handle.currentIteration.max}\n`);
          }
          if (handle.enrichProgress) {
            process.stdout.write(`  Enriching:  ${handle.enrichProgress.done}/${handle.enrichProgress.total} files\n`);
          }
          if (handle.verifyProgress) {
            process.stdout.write(`  Verifying:  ${handle.verifyProgress.passed}/${handle.verifyProgress.total} passed\n`);
          }
          if (handle.exitReason) {
            process.stdout.write(`  Exit:       ${handle.exitReason}\n`);
          }
          if (handle.error) {
            process.stdout.write(`  \x1b[31m⚠ Error: ${handle.error}\x1b[0m\n`);
          }
          process.stdout.write(`  Updated:    ${handle.lastEventAt}\n`);
          process.stdout.write("\n");
          process.exit(0);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Failed to read event stream: ${msg}\n`);
          process.exit(1);
        }
      }

      // Fallback: legacy autopilot-status.json
      if (fs.existsSync(legacyStatusFilePath)) {
        try {
          const raw = fs.readFileSync(legacyStatusFilePath, "utf8");
          const state = JSON.parse(raw) as {
            startedAt: number;
            iterationsCompleted: number;
            cumulativeCostUsd: number;
            costIsEstimated?: boolean;
            lastIterationProgress: boolean;
            lastIterationErrored: boolean;
            elapsedMs?: number;
            writtenAt?: string;
            phaseCount?: number;
            phasesCompleted?: number;
            mainCheckboxesTotal?: number;
            mainCheckboxesCompleted?: number;
          };

          const elapsed = state.elapsedMs !== undefined
            ? formatElapsed(state.elapsedMs)
            : formatElapsed(Date.now() - state.startedAt);
          const cost = formatCost(state.cumulativeCostUsd, state.costIsEstimated);

          process.stdout.write("\n\x1b[1mAutopilot Status\x1b[0m (legacy)\n\n");
          process.stdout.write(`  Elapsed:    ${elapsed}\n`);
          process.stdout.write(`  Iterations: ${state.iterationsCompleted} completed\n`);
          process.stdout.write(`  Cost:       ${cost}\n`);
          if (state.phaseCount !== undefined) {
            process.stdout.write(`  Phase:      ${state.phasesCompleted ?? 0}/${state.phaseCount}\n`);
          }
          if (state.mainCheckboxesTotal !== undefined) {
            process.stdout.write(`  Checkboxes: ${state.mainCheckboxesCompleted ?? 0}/${state.mainCheckboxesTotal}\n`);
          }
          process.stdout.write(`  Progress:   ${state.lastIterationProgress ? "✓ made progress" : "○ no progress"}\n`);
          if (state.lastIterationErrored) {
            process.stdout.write(`  \x1b[31m⚠ Last iteration errored\x1b[0m\n`);
          }
          if (state.writtenAt) {
            process.stdout.write(`  Updated:    ${state.writtenAt}\n`);
          }
          process.stdout.write("\n");
          process.exit(0);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Failed to read legacy status file: ${msg}\n`);
          process.exit(1);
        }
      }

      // Neither file found
      process.stderr.write("No autopilot status found. Is autopilot running?\n");
      process.stderr.write(`  Checked: ${eventFilePath}\n`);
      process.stderr.write(`  Checked: ${legacyStatusFilePath}\n`);
      process.exit(1);
    }

    let planPath = plan;

    // No --plan given: open interactive file picker
    if (!planPath) {
      const { pickPlanFile } = await import("./plan-picker.js");
      const picked = await pickPlanFile(process.cwd());
      if (!picked) {
        process.stderr.write("No plan selected.\n");
        process.exit(0);
      }
      planPath = picked;
    }

    // Resolve config (project + plan merge)
    const resolvedConfig = resolveConfig(cwd, planPath);

    // Apply CLI flag overrides (after merge, before validation and execution)
    const config = applyCLIOverrides(resolvedConfig, {
      adapter: adapterName,
      resume,
      maxIterationsPerPhase,
      parallel,
      ship,
    }) as AutopilotConfig;

    // Plan structure validation (item 4.5). Fail fast on missing
    // main.md or referenced-but-absent phase files. Errors abort the
    // command immediately; warnings are surfaced so the user can fix
    // the plan before invoking the autopilot. The orchestrator runs
    // the same check internally as a safety net.
    //
    // Bug A fix: runPreflightValidation auto-recovers from stale spec/
    // when all errors are missing-spec-phase-file and no phase has checked
    // items. On recovery, we print a one-line announcement and continue.
    const resolvedPlanPath = path.resolve(process.cwd(), planPath);
    const preflight = runPreflightValidation(resolvedPlanPath, resume);
    for (const w of preflight.warnings) {
      process.stderr.write(`  ⚠ ${w.message}${w.file ? ` (${w.file})` : ""}\n`);
    }
    if (preflight.recovered) {
      process.stderr.write(
        `\x1b[33m⟳ Stale spec detected — clearing spec/ and re-enriching\x1b[0m\n`,
      );
    } else if (preflight.exitCode !== null) {
      process.stderr.write(
        `\n\x1b[31m✗ Plan validation failed:\x1b[0m\n`,
      );
      for (const e of preflight.errors) {
        process.stderr.write(
          `  ${e.message}${e.file ? ` (${e.file})` : ""}\n`,
        );
      }
      process.exit(1);
    }

    // Print enrichment banner (the CLI renderer handles per-file progress)
    process.stderr.write("\n\x1b[1m→ Enriching plan\x1b[0m (deep model reads codebase, adds context)\n");
    process.stderr.write("  Adding mirror refs, code pointers, and conventions...\n");

    // Set GLRS_AGENT_OVERRIDES env var if the adapter is opencode and has agent overrides.
    // The plugin's config-hook reads this at server startup. Save the prior value so we
    // can restore it after the run (though the adapter's shutdown() also handles restoration
    // to keep the parent process clean).
    const priorAgentOverridesEnv = process.env["GLRS_AGENT_OVERRIDES"];
    const finalAdapterName = (config.adapter ?? DEFAULT_ADAPTER) as typeof DEFAULT_ADAPTER;
    if (finalAdapterName === "opencode") {
      const agentOverrides = config.adapters?.opencode?.agents;
      if (agentOverrides && Object.keys(agentOverrides).length > 0) {
        process.env["GLRS_AGENT_OVERRIDES"] = JSON.stringify(agentOverrides);
      }
    }

    let exitCode = 0;
    try {
      // Create SessionRunner — thin wrapper around enrichment + execution
      const adapter = await createAdapter(finalAdapterName, config);
      const runner = new SessionRunner({
        planPath: resolvedPlanPath,
        cwd: process.cwd(),
        resume,
        maxIterationsPerPhase,
        parallel,
        ship,
        adapter,
        enrichmentConfig: config.enrichment,
        config,
      });

      // Attach CLI renderer — subscribes to events and writes formatted text to stderr
      const renderer = createCliRenderer(runner.events);

      // Core-feature usage. Counts/flags only — no plan path or content.
      track("autopilot_started", {
        adapter: finalAdapterName,
        resume,
        ship,
        parallel: parallel ?? 1,
      });

      const result = await runner.run();
      renderer.unsubscribe();

      // Print enrichment completion line (after enrichment events have been rendered)
      process.stderr.write("  ✓ Plan enriched — executing\n\n");

      // Show completion summary using the canonical renderSummary helper
      const summary = renderSummary(result);
      process.stdout.write(summary.stdout);
      exitCode = summary.exitCode;

      // Outcome signal — same three buckets renderSummary uses.
      const { exitReason, iterations } = result.loopResult;
      const outcome = isSuccessExitReason(exitReason)
        ? "success"
        : exitReason === "kill-switch"
          ? "killed"
          : "failed";
      track("autopilot_finished", { outcome, iterations });
    } finally {
      // Restore the prior GLRS_AGENT_OVERRIDES env var value to keep the parent process clean.
      // The adapter's shutdown() also handles restoration, but we restore here for safety.
      if (priorAgentOverridesEnv === undefined) {
        delete process.env["GLRS_AGENT_OVERRIDES"];
      } else {
        process.env["GLRS_AGENT_OVERRIDES"] = priorAgentOverridesEnv;
      }
    }
    await flushAnalytics();
    process.exit(exitCode);
  },
});
