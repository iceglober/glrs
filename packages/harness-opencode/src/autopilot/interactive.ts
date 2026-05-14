/**
 * Interactive autopilot entry point.
 *
 * Two paths:
 *   A. Existing plan: user browses the plans directory, selects a plan
 *      file or directory, and the loop runs against it immediately
 *      (skipping scoping and planning).
 *   B. New feature: three sequential sessions:
 *      1. @scoper session (interactive wizard, produces scope.md)
 *      2. @plan session (headless, reads scope.md, produces the plan)
 *      3. loop session (headless, executes the plan)
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
  /** The user's initial goal text, passed to the @scoper wizard. */
  initialGoal: string;
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
  /** Mock for the "existing plan?" gate */
  promptExistingPlan?: () => Promise<boolean>;
  /** Mock for the plan-browser */
  browsePlans?: (planDir: string) => Promise<string | null>;
  /** Override getPlanDir */
  getPlanDir?: (cwd: string) => Promise<string>;
  /** Override fs.mkdirSync */
  mkdirSync?: (p: string, opts?: { recursive?: boolean }) => void;
  /** Override fs.writeFileSync */
  writeFileSync?: (p: string, content: string) => void;
  /** Override fs.readdirSync */
  readdirSync?: (p: string, opts: { withFileTypes: true }) => fs.Dirent[];
  /** Runner overrides */
  runScoper?: (opts: ScoperSessionOptions) => Promise<ScoperSessionResult>;
  runPlan?: (opts: PlanSessionOptions) => Promise<PlanSessionResult>;
  runLoop?: (opts: LoopSessionOptions) => Promise<LoopResult>;
  onBanner?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Plan browser — deterministic inquirer-driven directory navigation
// ---------------------------------------------------------------------------

/**
 * Browse the plans directory and let the user select a plan file or
 * directory. Returns the selected path, or null if the user backs out
 * to the top level and cancels.
 *
 * Selecting a directory = multi-file plan (loop runs against main.md).
 * Selecting a .md file = single-file plan.
 */
async function browsePlansDir(
  planDir: string,
  _readdirSync?: (p: string, opts: { withFileTypes: true }) => fs.Dirent[],
): Promise<string | null> {
  const { select } = await import("@inquirer/prompts");
  const readdir = _readdirSync ?? ((p: string, o: { withFileTypes: true }) => fs.readdirSync(p, o));

  let currentDir = planDir;

  while (true) {
    const entries = readdir(currentDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort();

    if (dirs.length === 0 && files.length === 0) {
      process.stderr.write(`\n  No plans found in ${currentDir}\n\n`);
      return null;
    }

    type Choice = { name: string; value: string };
    const choices: Choice[] = [];

    // Directories — selecting one either drills in or selects the whole dir
    for (const d of dirs) {
      const dirPath = path.join(currentDir, d);
      const hasMain = fs.existsSync(path.join(dirPath, "main.md"));
      const fileCount = readdir(dirPath, { withFileTypes: true }).filter((e) => e.isFile()).length;
      choices.push({
        name: hasMain
          ? `${d}/              (multi-file plan — ${fileCount} files)`
          : `${d}/              (${fileCount} files)`,
        value: `dir:${dirPath}`,
      });
    }

    // Files
    for (const f of files) {
      choices.push({
        name: `${f}`,
        value: `file:${path.join(currentDir, f)}`,
      });
    }

    // Navigation
    if (currentDir !== planDir) {
      choices.push({ name: "↩ Back", value: "back" });
    }
    choices.push({ name: "✕ Cancel (scope a new feature instead)", value: "cancel" });

    const answer = await select({
      message: "Select a plan:",
      choices,
    });

    if (answer === "cancel") return null;
    if (answer === "back") {
      currentDir = path.dirname(currentDir);
      continue;
    }

    if (answer.startsWith("file:")) {
      return answer.slice("file:".length);
    }

    if (answer.startsWith("dir:")) {
      const dirPath = answer.slice("dir:".length);
      const hasMain = fs.existsSync(path.join(dirPath, "main.md"));

      if (hasMain) {
        // Offer: select the whole directory (multi-file plan) or drill in
        const dirAction = await select({
          message: `${path.basename(dirPath)}/ has a main.md. What do you want?`,
          choices: [
            { name: "Select this as a multi-file plan", value: "select" },
            { name: "Browse files inside", value: "browse" },
            { name: "↩ Back", value: "back" },
          ],
        });

        if (dirAction === "select") return dirPath;
        if (dirAction === "browse") {
          currentDir = dirPath;
          continue;
        }
        // "back" — stay in current dir
        continue;
      }

      // No main.md — just drill in
      currentDir = dirPath;
      continue;
    }
  }
}

/**
 * CLI entry point for `glrs oc autopilot`.
 *
 * Two paths:
 *   A. Existing plan: browse plans dir, select, skip to loop.
 *   B. New feature: scope → plan → loop.
 */
export async function runInteractiveAutopilot(
  cwd: string,
  _deps?: InteractiveAutopilotDeps,
): Promise<AutopilotOrchestrationResult> {
  // Resolve plan directory early — needed for both paths
  const _getPlanDir = _deps?.getPlanDir ?? getPlanDir;
  const planDir = await _getPlanDir(cwd);

  // Gate: existing plan or new feature?
  let hasExistingPlan: boolean;
  if (_deps?.promptExistingPlan) {
    hasExistingPlan = await _deps.promptExistingPlan();
  } else {
    const { confirm } = await import("@inquirer/prompts");
    hasExistingPlan = await confirm({
      message: "Do you have an existing plan?",
      default: false,
    });
  }

  // Path A: existing plan — browse and run loop directly
  if (hasExistingPlan) {
    // Check both repo-local ./plans/ and the harness-shared plan dir.
    // Repo-local plans (written by humans) take priority in the listing.
    const repoLocalPlansDir = path.join(cwd, "plans");
    const hasRepoLocal = fs.existsSync(repoLocalPlansDir) && fs.statSync(repoLocalPlansDir).isDirectory();
    const hasShared = fs.existsSync(planDir) && fs.statSync(planDir).isDirectory();

    let browseRoot: string;
    if (hasRepoLocal && hasShared) {
      // Both exist — ask which to browse
      const { select } = await import("@inquirer/prompts");
      const which = await select({
        message: "Where are your plans?",
        choices: [
          { name: `./plans/ (repo-local)`, value: repoLocalPlansDir },
          { name: `${planDir} (harness-shared)`, value: planDir },
        ],
      });
      browseRoot = which;
    } else if (hasRepoLocal) {
      browseRoot = repoLocalPlansDir;
    } else {
      browseRoot = planDir;
    }

    let selectedPlan: string | null;
    if (_deps?.browsePlans) {
      selectedPlan = await _deps.browsePlans(browseRoot);
    } else {
      selectedPlan = await browsePlansDir(browseRoot, _deps?.readdirSync);
    }

    if (!selectedPlan) {
      // User cancelled — fall through to Path B
      process.stderr.write("\n  No plan selected. Starting new feature scoping.\n\n");
    } else {
      // Determine if it's a directory (multi-file) or file (single-file)
      const isDir = fs.statSync(selectedPlan).isDirectory();
      const planPath = isDir ? selectedPlan : selectedPlan;

      // Pre-flight: parse the plan and check if there's actually work to do
      const { parsePlanState } = await import("./plan-parser.js");
      const planState = parsePlanState(planPath);

      if (planState.totalItems > 0 && planState.checkedItems === planState.totalItems) {
        // All items checked — warn the user
        const { select: selectAction } = await import("@inquirer/prompts");
        const action = await selectAction({
          message: `All ${planState.totalItems} items in this plan are already checked. What do you want to do?`,
          choices: [
            { name: "Uncheck all items and run from scratch", value: "uncheck" },
            { name: "Run anyway (agent will verify/audit the checked items)", value: "run" },
            { name: "Cancel and pick a different plan", value: "cancel" },
          ],
        });

        if (action === "cancel") {
          process.stderr.write("\n  Cancelled. Starting new feature scoping.\n\n");
          // Fall through to Path B below
        } else {
          if (action === "uncheck") {
            // Uncheck all items in all .md files in the plan
            const uncheckFiles = isDir
              ? fs.readdirSync(planPath).filter((f) => f.endsWith(".md")).map((f) => path.join(planPath, f))
              : [planPath];
            for (const file of uncheckFiles) {
              const content = fs.readFileSync(file, "utf-8");
              const unchecked = content.replace(/- \[x\]/g, "- [ ]");
              fs.writeFileSync(file, unchecked);
            }
            process.stderr.write(`\n  ✓ Unchecked all items in ${uncheckFiles.length} file(s).\n\n`);
          }

          const banner = _deps?.onBanner ?? ((msg: string) => process.stdout.write(`\n${msg}\n`));
          banner(`→ Running loop against plan: ${planPath}`);

          const { runLoopSession } = await import("./loop-session.js");
          const _runLoop = _deps?.runLoop ?? runLoopSession;
          const loopResult = await _runLoop({ planPath, cwd });

          return {
            scopePath: "",
            planPath,
            loopResult,
          };
        }
      } else {
        // Plan has unchecked items — proceed normally
        const unchecked = planState.totalItems - planState.checkedItems;
        process.stderr.write(
          `\n  Plan: ${planState.totalItems} items, ${unchecked} remaining.\n\n`,
        );

        const banner = _deps?.onBanner ?? ((msg: string) => process.stdout.write(`\n${msg}\n`));
        banner(`→ Running loop against plan: ${planPath}`);

        const { runLoopSession } = await import("./loop-session.js");
        const _runLoop = _deps?.runLoop ?? runLoopSession;
        const loopResult = await _runLoop({ planPath, cwd });

        return {
          scopePath: "",
          planPath,
          loopResult,
        };
      }
    }
  }

  // Path B: new feature — scope → plan → loop
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
    { slug, planDir, cwd, initialGoal: goal },
    {
      runScoper: _deps?.runScoper ?? runScoperSession,
      runPlan: _deps?.runPlan ?? runPlanSession,
      runLoop: _deps?.runLoop ?? runLoopSession,
      onBanner: _deps?.onBanner,
    },
  );
}
