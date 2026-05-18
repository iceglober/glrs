/**
 * `glrs oc autopilot` — Interactive three-phase autopilot orchestrator.
 *
 * --plan / -p <path>: use an existing plan at this path.
 * --fast / -f: enrich plan for fast-model execution, then run with mid-execute tier.
 * --status: read and pretty-print the current autopilot status from .agent/autopilot-status.json.
 *
 * When no --plan is given, opens an interactive file picker.
 * When a plan is provided and has checkboxes, skips scoping/planning and executes directly.
 *
 * This is a thin wrapper: parse args → create SessionRunner → attach CLI renderer → run.
 */

import { command, flag, option, optional, string as stringType, number as numberType, oneOf } from "cmd-ts";
import * as path from "node:path";
import * as fs from "node:fs";
import { formatElapsed, formatCost, EventStreamReader, deriveState } from "@glrs-dev/autopilot";
import { SessionRunner } from "@glrs-dev/autopilot";
import { createCliRenderer } from "../cli-renderer.js";
import { createAdapter, ADAPTER_NAMES, DEFAULT_ADAPTER } from "../adapter-factory.js";
import { resolveConfig } from "../autopilot/config-reader.js";

export const autopilotInteractiveCmd = command({
  name: "autopilot",
  description:
    "Run the autopilot. Use -p <path> to provide a plan, or omit to pick one interactively. Use -f for fast-model execution. Use --status to check the current run status.",
  args: {
    plan: option({
      long: "plan",
      short: "p",
      type: optional(stringType),
      description:
        "Path to an existing plan file or directory. If omitted, opens an interactive file picker.",
    }),
    fast: flag({
      long: "fast",
      short: "f",
      description:
        "Use the fast executor model (mid-execute tier). Enriches the plan first so cheaper models can execute reliably.",
    }),
    resume: flag({
      long: "resume",
      description:
        "Resume from .agent/autopilot-checkpoint.json: skip phases listed in completedPhases (when the checkpoint's planPath matches --plan).",
    }),
    maxIterationsPerPhase: option({
      long: "max-iterations-per-phase",
      type: optional(numberType),
      description:
        "Per-phase iteration budget. Override the tier default (deep=5, mid-execute/autopilot-execute=10, fast=10). A phase that hits this budget without completing is treated as a soft failure: a checkpoint is written, a warning is logged, and the run continues to the next phase.",
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
  },
  handler: async ({ plan, fast, resume, maxIterationsPerPhase, parallel, ship, status, adapter: adapterName }) => {
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

    // Resolve config (before enrichment and validation)
    const config = resolveConfig(cwd, planPath);

    // CLI flag overrides config
    if (adapterName) {
      config.adapter = adapterName as "opencode" | "claude-code-cli";
    }

    // Plan structure validation (item 4.5). Fail fast on missing
    // main.md or referenced-but-absent phase files. Errors abort the
    // command immediately; warnings are surfaced so the user can fix
    // the plan before invoking the autopilot. The orchestrator runs
    // the same check internally as a safety net.
    const { validatePlan } = await import("@glrs-dev/autopilot");
    const validation = validatePlan(path.resolve(process.cwd(), planPath));
    for (const w of validation.warnings) {
      process.stderr.write(`  ⚠ ${w.message}${w.file ? ` (${w.file})` : ""}\n`);
    }
    if (validation.errors.length > 0) {
      process.stderr.write(
        `\n\x1b[31m✗ Plan validation failed:\x1b[0m\n`,
      );
      for (const e of validation.errors) {
        process.stderr.write(
          `  ${e.message}${e.file ? ` (${e.file})` : ""}\n`,
        );
      }
      process.exit(1);
    }

    // Print enrichment banner before starting (the CLI renderer handles per-file progress)
    if (fast && planPath) {
      process.stderr.write("\n\x1b[1m→ Enriching plan for fast execution\x1b[0m (deep model reads codebase, adds context)\n");
      process.stderr.write("  Adding mirror refs, code pointers, and conventions...\n");
    }

    // Create SessionRunner — thin wrapper around enrichment + execution
    const adapter = await createAdapter((config.adapter ?? DEFAULT_ADAPTER) as typeof DEFAULT_ADAPTER, config);
    const runner = new SessionRunner({
      planPath: path.resolve(process.cwd(), planPath),
      cwd: process.cwd(),
      fast,
      resume,
      maxIterationsPerPhase,
      parallel,
      ship,
      adapter,
      enrichmentConfig: config.enrichment,
    });

    // Attach CLI renderer — subscribes to events and writes formatted text to stderr
    const renderer = createCliRenderer(runner.events);

    const result = await runner.run();
    renderer.unsubscribe();

    // Print enrichment completion line (after enrichment events have been rendered)
    if (fast && planPath) {
      process.stderr.write("  ✓ Plan enriched — executing with fast model (mid-execute tier)\n\n");
    }

    // Show completion summary
    const costStr = result.loopResult.cumulativeCostUsd
      ? ` · $${result.loopResult.cumulativeCostUsd.toFixed(2)}`
      : "";
    process.stdout.write(
      `\n\x1b[1m✓ Autopilot complete\x1b[0m\n` +
        `  Plan:   ${result.planPath}\n` +
        `  Result: ${result.loopResult.exitReason} after ${result.loopResult.iterations} iteration(s)${costStr}\n` +
        `\n`,
    );
  },
});
