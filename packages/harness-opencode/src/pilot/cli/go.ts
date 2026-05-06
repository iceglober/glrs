/**
 * `pilot go` — run the autonomous SPEAR loop.
 *
 * Reads the current scope (from `pilot scope`) and runs:
 * Plan → Execute → Assess → (re-plan if fail) → Resolve
 */

import { command, option, string as stringType, optional } from "cmd-ts";
import { runOrchestrator } from "../orchestrator.js";

export const goCmd = command({
  name: "go",
  description: "Run the autonomous SPEAR loop (Plan → Execute → Assess → Resolve). Requires a scope from `pilot scope`.",
  args: {
    scope: option({
      long: "scope",
      type: optional(stringType),
      description: "Path to scope.json (defaults to the current scope from `pilot scope`)",
    }),
  },
  handler: async ({ scope }) => {
    const cwd = process.cwd();

    console.log("\n\x1b[1mPilot v2 — Autonomous execution\x1b[0m");
    console.log("Running: Plan → Execute → Assess → Resolve\n");

    const result = await runOrchestrator({ cwd, scopePath: scope });

    if (!result.ok) {
      process.stderr.write(`\n\x1b[31m✗\x1b[0m Pilot failed: ${result.reason}\n`);
      if (result.workflowId) {
        process.stderr.write(`  Workflow: ${result.workflowId}\n`);
      }
      process.exit(1);
    }

    const durationSec = Math.round(result.durationMs / 1000);
    const durationStr = durationSec >= 60
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : `${durationSec}s`;

    console.log(`\n\x1b[32m✓\x1b[0m Workflow complete`);
    console.log(`  Goal: ${result.goal}`);
    console.log(`  Duration: ${durationStr}`);
    if (result.acknowledgedRisks.length > 0) {
      console.log(`\n  Acknowledged risks (non-blocking):`);
      for (const risk of result.acknowledgedRisks) {
        console.log(`    • ${risk}`);
      }
    }
    console.log();

    process.exit(0);
  },
});
