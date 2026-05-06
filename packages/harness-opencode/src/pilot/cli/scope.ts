/**
 * `pilot scope "<goal>"` — start a new pilot workflow with interactive scoping.
 *
 * Spawns an OpenCode TUI session with the pilot-scoper agent.
 * The user converses with the scoper to define framing and acceptance criteria.
 * Produces scope.json and a current-scope pointer for `pilot go`.
 */

import { command, positional, string } from "cmd-ts";
import { runScopePhase } from "../scope.js";

export const scopeCmd = command({
  name: "scope",
  description: "Start a new pilot workflow with interactive scoping. Produces scope.json for `pilot go`.",
  args: {
    goal: positional({
      type: string,
      displayName: "goal",
      description: "What you want to build (e.g. \"Add dark mode toggle to settings page\")",
    }),
  },
  handler: async ({ goal }) => {
    const cwd = process.cwd();

    console.log(`\n\x1b[1mPilot v2 — Scope phase\x1b[0m`);
    console.log(`Goal: ${goal}\n`);
    console.log("Starting interactive scoping session...");
    console.log("The scoper will interview you and explore the codebase.");
    console.log("When done, it will produce scope.json for \`pilot go\`.\n");

    const result = await runScopePhase({ goal, cwd });

    if (!result.ok) {
      process.stderr.write(`\n\x1b[31m✗\x1b[0m Scope phase failed: ${result.reason}\n`);
      process.exit(1);
    }

    console.log(`\n\x1b[32m✓\x1b[0m Scope complete`);
    console.log(`  Workflow: ${result.workflowId}`);
    console.log(`  Goal: ${result.artifact.goal}`);
    console.log(`  Acceptance criteria: ${result.artifact.acceptance_criteria.length}`);
    console.log(`  Scope: ${result.scopePath}`);
    console.log(`\nRun \x1b[1mpilot go\x1b[0m to start autonomous execution.\n`);

    process.exit(0);
  },
});
