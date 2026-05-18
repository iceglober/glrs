/**
 * Interactive autopilot entry point.
 *
 * Two paths:
 *   A. Plan-path provided: read the file, extract goal from title/## Goal,
 *      pass content to the scoper as context, then scope → plan → loop.
 *   B. No plan path: prompt for goal interactively, then scope → plan → loop.
 *
 * The scoper always runs — a provided plan is context for scoping, not a bypass.
 * Each phase prints a structured status banner to the terminal.
 * Dependency-injected for testability.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ScoperSessionOptions, ScoperSessionResult } from "@glrs-dev/autopilot";
import type { LoopResult } from "@glrs-dev/autopilot";
import type { AutopilotLogger } from "@glrs-dev/autopilot";
import type { SessionEventEmitter } from "@glrs-dev/autopilot";
import { getPlanDir } from "../plan-paths.js";

export type {
  PlanSessionOptions,
  PlanSessionResult,
  LoopSessionOptions,
} from "@glrs-dev/autopilot";
import type {
  PlanSessionOptions,
  PlanSessionResult,
  LoopSessionOptions,
} from "@glrs-dev/autopilot";

export interface AutopilotOrchestrationOptions {
  slug: string;
  planDir: string;
  cwd?: string;
  /** The user's initial goal text, passed to the @scoper wizard. */
  initialGoal: string;
  /** When provided, passed to the scoper so it can ground questions in the existing plan. */
  existingPlanContent?: string;
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
    initialGoal: opts.initialGoal,
    ...(opts.existingPlanContent ? { existingPlanContent: opts.existingPlanContent } : {}),
  });
  banner(`✓ Scope captured at ${scoperResult.scopePath}`);

  // Phase 2: Plan session
  // Derive the slug from the scoper's output path — the scoper may have
  // used a different slug than what we derived from the goal text (e.g.,
  // if the agent chose a better name, or if the goal text was corrupted
  // by a terminal paste artifact).
  const actualSlug = path.basename(path.dirname(scoperResult.scopePath));
  banner("→ Phase 2/3: Planning (headless)...");
  const planResult = await deps.runPlan({
    scopePath: scoperResult.scopePath,
    planDir: opts.planDir,
    slug: actualSlug || opts.slug,
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

// ---------------------------------------------------------------------------
// Goal extraction from plan file
// ---------------------------------------------------------------------------

/**
 * Extract the goal from a plan file's content.
 * Tries:
 *   1. First `# Title` (H1 heading)
 *   2. First paragraph after `## Goal`
 *   3. Filename without extension (dashes → spaces)
 */
function extractGoalFromPlan(content: string, filePath: string): string {
  // Try H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Try first paragraph after ## Goal
  const goalSectionMatch = content.match(/^##\s+Goal\s*\n+([^\n#][^\n]*)/m);
  if (goalSectionMatch) return goalSectionMatch[1].trim();

  // Fallback: filename without extension, dashes → spaces
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/-/g, " ");
}

/**
 * CLI entry point for `glrs oc autopilot`.
 *
 * When planPath is provided: read the file, extract goal, pass content to scoper.
 * When omitted: prompt for goal interactively, then scope → plan → loop.
 */
export async function runInteractiveAutopilot(
  cwd: string,
  planPath?: string,
  _deps?: InteractiveAutopilotDeps,
  options?: { fast?: boolean; resume?: boolean; maxIterationsPerPhase?: number; parallel?: number; ship?: boolean; logger?: AutopilotLogger },
): Promise<AutopilotOrchestrationResult> {
  // Resolve plan directory early
  const _getPlanDir = _deps?.getPlanDir ?? getPlanDir;
  const planDir = await _getPlanDir(cwd);

  let goal: string;
  let ticketRef: string;
  let existingPlanContent: string | undefined;

  if (planPath) {
    // Resolve the plan path relative to cwd
    const resolvedPath = path.resolve(cwd, planPath);
    const isDir = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();
    const hasMainMd = isDir && fs.existsSync(path.join(resolvedPath, "main.md"));
    const isMdFile = !isDir && resolvedPath.endsWith(".md") && fs.existsSync(resolvedPath);

    // Directory without main.md — open the picker starting there
    if (isDir && !hasMainMd) {
      const { pickPlanFile } = await import("./plan-picker.js");
      const picked = await pickPlanFile(resolvedPath);
      if (!picked) {
        return {
          scopePath: "",
          planPath: resolvedPath,
          loopResult: { exitReason: "error" as const, iterations: 0, message: "No plan selected." },
        };
      }
      // Recurse with the picked path
      return runInteractiveAutopilot(cwd, picked, _deps, options);
    }

    if (hasMainMd || isMdFile) {
      // Check if this is actually an executable plan (has checkboxes).
      // A .md file without checkboxes is just a document — treat it as
      // context for scoping, not an executable plan.
      const { parsePlanState } = await import("@glrs-dev/autopilot");
      const planState = parsePlanState(resolvedPath);

      if (planState.totalItems > 0) {
        // Existing executable plan — validate and run against it in place.
        const banner = _deps?.onBanner ?? ((msg: string) => process.stdout.write(`\n${msg}\n`));
        const unchecked = planState.totalItems - planState.checkedItems;

        if (unchecked === 0) {
          banner(`⚠ All ${planState.totalItems} items already checked — nothing to execute`);
          return {
            scopePath: "",
            planPath: resolvedPath,
            loopResult: { exitReason: "sentinel", iterations: 0, message: "All items already checked." },
          };
        }

        banner(`→ Plan validated: ${unchecked}/${planState.totalItems} items remaining`);
        if (planState.type === "multi") {
          banner(`  ${planState.phaseCount} phases, ${planState.phaseCount - planState.phasesCompleted} remaining`);
        }
        banner(`→ Executing against: ${resolvedPath}`);

        const { runLoopSession } = await import("@glrs-dev/autopilot");
        const _runLoop = _deps?.runLoop ?? runLoopSession;
        const loopResult = await _runLoop({ planPath: resolvedPath, cwd, fast: options?.fast, resume: options?.resume, maxIterationsPerPhase: options?.maxIterationsPerPhase, parallel: options?.parallel, ship: options?.ship, logger: options?.logger });

        return {
          scopePath: "",
          planPath: resolvedPath,
          loopResult,
        };
      }

      // Directory with main.md but no checkboxes — still treat as a plan
      // (the phase files may have the checkboxes, or it's a prose plan).
      if (isDir) {
        const banner = _deps?.onBanner ?? ((msg: string) => process.stdout.write(`\n${msg}\n`));
        banner(`→ Executing plan directory: ${resolvedPath}`);

        const { runLoopSession } = await import("@glrs-dev/autopilot");
        const _runLoop = _deps?.runLoop ?? runLoopSession;
        const loopResult = await _runLoop({ planPath: resolvedPath, cwd, fast: options?.fast, resume: options?.resume, maxIterationsPerPhase: options?.maxIterationsPerPhase, parallel: options?.parallel, ship: options?.ship, logger: options?.logger });

        return {
          scopePath: "",
          planPath: resolvedPath,
          loopResult,
        };
      }

      // Single .md file without checkboxes — treat as scoping context
    }

    // Plan path provided but not a recognized plan structure — treat as
    // context for scoping (the file might be a requirements doc, issue
    // description, etc.)
    const content = fs.readFileSync(resolvedPath, "utf-8");
    goal = extractGoalFromPlan(content, resolvedPath);
    ticketRef = "";
    existingPlanContent = content;
  } else {
    // Interactive flow: prompt for goal and ticket ref
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
  }

  // Derive slug from goal
  const slug = deriveSlug(goal);

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
  const { runPlanSession } = await import("@glrs-dev/autopilot");
  const { runLoopSession } = await import("@glrs-dev/autopilot");

  return orchestrateAutopilot(
    { slug, planDir, cwd, initialGoal: goal, existingPlanContent },
    {
      runScoper: _deps?.runScoper ?? runScoperSession,
      runPlan: _deps?.runPlan ?? ((opts) => {
        // In production, adapter is injected via the CLI; in tests, _deps.runPlan is provided.
        // This wrapper satisfies the AutopilotOrchestrationDeps.runPlan type.
        const { OpenCodeAdapter } = require("@glrs-dev/adapter-opencode") as typeof import("@glrs-dev/adapter-opencode");
        return runPlanSession({ ...opts, adapter: new OpenCodeAdapter() });
      }),
      runLoop: _deps?.runLoop ?? runLoopSession,
      onBanner: _deps?.onBanner,
    },
  );
}
