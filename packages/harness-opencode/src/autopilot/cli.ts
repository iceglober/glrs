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
 *
 * After the loop exits, optionally runs a @debriefer session to produce
 * a structured post-run summary. Skip with --no-debrief or
 * GLRS_AUTOPILOT_DEBRIEF=off.
 */

import { command, option, positional, string as stringType, optional, number as numberType, flag } from "cmd-ts";
import { runRalphLoop } from "./loop.js";
import { runDebrief, shouldRunDebrief } from "./debrief.js";
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
    noDebrief: flag({
      long: "no-debrief",
      description: "Skip the post-run debrief session.",
    }),
  },
  handler: async ({ prompt, maxIterations, timeout, noDebrief }) => {
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

    // Run debrief unless suppressed by flag or env var.
    if (shouldRunDebrief({ noDebrief, env: process.env as Record<string, string | undefined> })) {
      const { startServer } = await import("../lib/opencode-server.js");
      let debriefServer;
      try {
        debriefServer = await startServer({ cwd });
        await runDebrief({
          server: debriefServer,
          loopResult: result,
          prompt,
          cwd,
        });
      } catch {
        process.stderr.write("\x1b[33m⚠ Debrief server failed to start (non-fatal)\x1b[0m\n");
      } finally {
        await debriefServer?.shutdown().catch(() => {});
      }
    }

    if (result.exitReason !== "sentinel" && result.exitReason !== "kill-switch") {
      process.exit(1);
    }

    process.exit(0);
  },
});
