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

import * as fs from "node:fs";
import * as path from "node:path";
import type { ScoperSessionOptions, ScoperSessionResult } from "./scoper.js";
import type { LoopResult } from "./loop.js";
import { getPlanDir } from "../plan-paths.js";

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
 * Derive a URL-safe slug from a free-form goal string.
 * Lowercase, replace non-alphanumeric runs with `-`, truncate to 40 chars.
 * Falls back to `feature-<timestamp>` if the result is empty.
 */
export function deriveSlug(goal: string): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : `feature-${Date.now()}`;
}

/**
 * Injectable dependencies for runInteractiveAutopilot.
 * Allows tests to mock inquirer prompts, runner functions, and fs.
 * @internal
 */
export interface InteractiveAutopilotDeps {
  /** Mock for @inquirer/prompts input() */
  promptGoal?: () => Promise<string>;
  /** Mock for @inquirer/prompts input() (ticket ref) */
  promptTicketRef?: () => Promise<string>;
  /** Override getPlanDir */
  getPlanDir?: (cwd: string) => Promise<string>;
  /** Override fs.mkdirSync */
  mkdirSync?: (p: string, opts?: { recursive?: boolean }) => void;
  /** Override fs.writeFileSync */
  writeFileSync?: (p: string, content: string) => void;
  /** Runner overrides */
  runScoper?: (opts: ScoperSessionOptions) => Promise<ScoperSessionResult>;
  runPlan?: (opts: PlanSessionOptions) => Promise<PlanSessionResult>;
  runLoop?: (opts: LoopSessionOptions) => Promise<LoopResult>;
  onBanner?: (message: string) => void;
}

/**
 * CLI entry point for `glrs oc autopilot`.
 *
 * Collects initial input from the user via inquirer, derives a slug,
 * resolves the plan directory, writes a scope-seed.md, then runs the
 * three-phase orchestrator with real session runners.
 */
export async function runInteractiveAutopilot(
  cwd: string,
  _deps?: InteractiveAutopilotDeps,
): Promise<AutopilotOrchestrationResult> {
  // Collect initial input
  let goal: string;
  let ticketRef: string;

  if (_deps?.promptGoal) {
    goal = await _deps.promptGoal();
  } else {
    const { input } = await import("@inquirer/prompts");
    goal = await input({
      message: "What do you want to build? (one sentence, free-form)",
      validate: (v) => (v.trim().length > 0 ? true : "Please describe what you want to build."),
    });
  }

  if (_deps?.promptTicketRef) {
    ticketRef = await _deps.promptTicketRef();
  } else {
    const { input } = await import("@inquirer/prompts");
    ticketRef = await input({
      message: "Optional ticket or issue ref (Linear ID, GitHub issue URL, etc.)",
      default: "",
    });
  }

  // Derive slug from goal
  const slug = deriveSlug(goal);

  // Resolve plan directory
  const _getPlanDir = _deps?.getPlanDir ?? getPlanDir;
  const planDir = await _getPlanDir(cwd);

  // Write scope-seed.md
  const seedDir = path.join(planDir, slug);
  const seedPath = path.join(seedDir, "scope-seed.md");

  const _mkdirSync = _deps?.mkdirSync ?? ((p: string, o?: { recursive?: boolean }) => fs.mkdirSync(p, o));
  const _writeFileSync = _deps?.writeFileSync ?? fs.writeFileSync;

  _mkdirSync(seedDir, { recursive: true });

  const seedContent = [
    `# Scope Seed: ${slug}`,
    "",
    `## Goal`,
    "",
    goal,
    "",
    ...(ticketRef.trim()
      ? [`## Ticket / Issue Ref`, "", ticketRef.trim(), ""]
      : []),
  ].join("\n");

  _writeFileSync(seedPath, seedContent);

  // Import real runners (lazy to avoid circular deps in tests)
  const { runScoperSession } = await import("./scoper.js");
  const { runPlanSession } = await import("./plan-session.js");
  const { runLoopSession } = await import("./loop-session.js");

  return orchestrateAutopilot(
    { slug, planDir, cwd },
    {
      runScoper: _deps?.runScoper ?? runScoperSession,
      runPlan: _deps?.runPlan ?? runPlanSession,
      runLoop: _deps?.runLoop ?? runLoopSession,
      onBanner: _deps?.onBanner,
    },
  );
}
