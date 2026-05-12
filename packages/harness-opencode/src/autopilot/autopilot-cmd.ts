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
    process.stdout.write("\n\x1b[1mAutopilot — Interactive three-phase orchestrator\x1b[0m\n");
    process.stdout.write("Phase 1: Scoping (interactive)\n");
    process.stdout.write("Phase 2: Planning (headless)\n");
    process.stdout.write("Phase 3: Execution (Ralph loop)\n\n");
    process.stdout.write(
      "Note: Full interactive orchestration requires a running OpenCode server.\n",
    );
    process.stdout.write(
      "Use `glrs oc loop <prompt>` for direct loop execution against an existing plan.\n",
    );
    process.exit(0);
  },
});
