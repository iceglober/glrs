/**
 * `glrs oc loop` — Ralph loop CLI driver.
 *
 * Starts an OpenCode server, creates a session with PRIME, sends the
 * user's prompt each iteration, and exits when the agent emits
 * `<autopilot-done>` or a budget is exhausted.
 *
 * PR 3 diverged `loop` and `autopilot`: `loop` is the raw-prompt
 * Ralph-loop runner; `autopilot` is the interactive three-phase
 * orchestrator (scope → plan → loop). They are now separate subcommands.
 */

import { command, option, positional, string as stringType, optional, number as numberType } from "cmd-ts";
import { runRalphLoop } from "./loop.js";
import { MAX_ITERATIONS, TIMEOUT_MS } from "./config.js";

export const loopCmd = command({
  name: "loop",
  description:
    'Run the Ralph loop: send a prompt to PRIME repeatedly until it emits <autopilot-done> or a budget is exhausted.',
  args: {
    prompt: positional({
      type: stringType,
      displayName: "prompt",
      description: "The prompt to send to PRIME each iteration (e.g. a Linear issue ref or free-form task).",
    }),
    maxIterations: option({
      long: "max-iterations",
      type: optional(numberType),
      description: `Maximum number of loop iterations (default: ${MAX_ITERATIONS}).`,
    }),
    timeout: option({
      long: "timeout",
      type: optional(numberType),
      description: `Total wall-clock timeout in milliseconds (default: ${TIMEOUT_MS} = 4 hours).`,
    }),
  },
  handler: async ({ prompt, maxIterations, timeout }) => {
    const cwd = process.cwd();

    process.stdout.write("\n\x1b[1mAutopilot — Ralph loop\x1b[0m\n");
    process.stdout.write(`Prompt: ${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}\n`);
    process.stdout.write(`Max iterations: ${maxIterations ?? MAX_ITERATIONS}\n`);
    process.stdout.write(`Timeout: ${((timeout ?? TIMEOUT_MS) / 3600000).toFixed(1)}h\n\n`);

    const result = await runRalphLoop({
      prompt,
      cwd,
      maxIterations: maxIterations ?? undefined,
      timeoutMs: timeout ?? undefined,
    });

    const icon =
      result.exitReason === "sentinel"
        ? "\x1b[32m✓\x1b[0m"
        : result.exitReason === "kill-switch"
          ? "\x1b[33m⊘\x1b[0m"
          : "\x1b[31m✗\x1b[0m";

    process.stdout.write(`\n${icon} ${result.message}\n`);
    process.stdout.write(`  Iterations: ${result.iterations}\n\n`);

    if (result.exitReason !== "sentinel" && result.exitReason !== "kill-switch") {
      process.exit(1);
    }

    process.exit(0);
  },
});


