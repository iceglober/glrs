/**
 * `glrs oc autopilot` — Interactive three-phase autopilot orchestrator.
 *
 * Diverged from `loop` in PR 3. This command runs the interactive
 * scoping walkthrough: scope → plan → loop.
 *
 * Phase 1: @scoper session (interactive, produces scope.md)
 * Phase 2: @plan session (headless, reads scope.md, produces the plan)
 * Phase 3: loop session (headless, executes the plan)
 */

import { command, option, optional, string as stringType } from "cmd-ts";
import { runInteractiveAutopilot } from "./interactive.js";

export const autopilotInteractiveCmd = command({
  name: "autopilot",
  description:
    "Interactive three-phase autopilot: scope with @scoper, plan with @plan, then execute with the Ralph loop. Produces a structured plan before running.",
  args: {
    slug: option({
      long: "slug",
      type: optional(stringType),
      description:
        "Plan slug (kebab-case, ≤5 words). If omitted, you will be prompted during the scoping session.",
    }),
  },
  handler: async ({ slug: _slug }) => {
    const result = await runInteractiveAutopilot(process.cwd());
    process.stdout.write(
      `\n\x1b[1m✓ Autopilot complete\x1b[0m\n` +
        `  Scope:  ${result.scopePath}\n` +
        `  Plan:   ${result.planPath}\n` +
        `  Loop:   ${result.loopResult.exitReason} after ${result.loopResult.iterations} iteration(s)\n`,
    );
  },
});
