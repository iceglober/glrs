/**
 * Interactive autopilot entry point.
 *
 * Orchestrates three sequential sessions:
 *   1. @scoper session (interactive, produces scope.md)
 *   2. @plan session (headless, reads scope.md, produces the plan)
 *   3. loop session (headless, executes the plan)
 *
 * Each phase prints a structured status banner to the terminal.
 * Dependency-injected for testability.
 */

import type { ScoperSessionOptions, ScoperSessionResult } from "./scoper.js";
import type { LoopResult } from "./loop.js";

export interface PlanSessionOptions {
  scopePath: string;
  planDir: string;
  slug: string;
}

export interface PlanSessionResult {
  planPath: string;
}

export interface LoopSessionOptions {
  planPath: string;
  cwd: string;
}

export interface AutopilotOrchestrationOptions {
  slug: string;
  planDir: string;
  cwd?: string;
}

export interface AutopilotOrchestrationResult {
  scopePath: string;
  planPath: string;
  loopResult: LoopResult;
}

export interface AutopilotOrchestrationDeps {
  runScoper: (opts: ScoperSessionOptions) => Promise<ScoperSessionResult>;
  runPlan: (opts: PlanSessionOptions) => Promise<PlanSessionResult>;
  runLoop: (opts: LoopSessionOptions) => Promise<LoopResult>;
  onBanner?: (message: string) => void;
}

function defaultBanner(message: string): void {
  process.stdout.write(`\n${message}\n`);
}

/**
 * Orchestrate the three-phase interactive autopilot workflow.
 *
 * @param opts - Orchestration options (slug, planDir, cwd)
 * @param deps - Injected dependencies (for testing)
 */
export async function orchestrateAutopilot(
  opts: AutopilotOrchestrationOptions,
  deps: AutopilotOrchestrationDeps,
): Promise<AutopilotOrchestrationResult> {
  const banner = deps.onBanner ?? defaultBanner;
  const cwd = opts.cwd ?? process.cwd();

  // Phase 1: Scoper session
  banner("→ Phase 1/3: Scoping (interactive)...");
  const scoperResult = await deps.runScoper({
    planDir: opts.planDir,
    slug: opts.slug,
  });
  banner(`✓ Scope captured at ${scoperResult.scopePath}`);

  // Phase 2: Plan session
  banner("→ Phase 2/3: Planning (headless)...");
  const planResult = await deps.runPlan({
    scopePath: scoperResult.scopePath,
    planDir: opts.planDir,
    slug: opts.slug,
  });
  banner(`✓ Plan written at ${planResult.planPath}`);

  // Phase 3: Loop session
  banner("→ Phase 3/3: Executing (headless loop)...");
  const loopResult = await deps.runLoop({
    planPath: planResult.planPath,
    cwd,
  });

  return {
    scopePath: scoperResult.scopePath,
    planPath: planResult.planPath,
    loopResult,
  };
}

/**
 * CLI entry point for `glrs oc autopilot`.
 * Wires real implementations into the orchestrator.
 */
export async function runInteractiveAutopilot(opts: {
  slug: string;
  planDir: string;
  cwd?: string;
}): Promise<void> {
  // Real implementations are wired here when the CLI invokes this.
  // For now this is a stub — the CLI command will be wired in cli.ts.
  throw new Error(
    "runInteractiveAutopilot: real session spawning not yet implemented. " +
      "Use orchestrateAutopilot with injected deps for testing.",
  );
}
