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

import { command, option, positional, string as stringType, optional, number as numberType, flag, oneOf } from "cmd-ts";
import { runRalphLoop, MAX_ITERATIONS, TIMEOUT_MS, applyCLIOverrides } from "@glrs-dev/autopilot";
import { runDebrief, shouldRunDebrief } from "./debrief.js";
import { createAdapter, ADAPTER_NAMES, DEFAULT_ADAPTER } from "../adapter-factory.js";
import { resolveConfig } from "../autopilot/config-reader.js";
import type { AutopilotConfig } from "../autopilot/autopilot-config.js";

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
    stallTimeout: option({
      long: "stall-timeout",
      type: optional(numberType),
      description:
        "Per-iteration stall timeout in milliseconds. Overrides the tier-based default (deep=30m, mid=15m, mid-execute/autopilot-execute=10m, fast=5m).",
    }),
    noDebrief: flag({
      long: "no-debrief",
      description: "Skip the post-run debrief session.",
    }),
    notify: option({
      long: "notify",
      type: optional(stringType),
      description: "Webhook URL to POST lifecycle events to (supports plain webhooks and Slack incoming webhooks).",
    }),
    debriefOnly: flag({
      long: "debrief-only",
      description: "Run the debrief against the most recent log file without re-executing the loop. (Not yet implemented — requires log-directory discovery.)",
    }),
    adapter: option({
      long: "adapter",
      short: "a",
      type: optional(oneOf(ADAPTER_NAMES as unknown as string[])),
      description: `Agent adapter to use (default: ${DEFAULT_ADAPTER}). Available: ${ADAPTER_NAMES.join(", ")}`,
    }),
  },
  handler: async ({ prompt, maxIterations, timeout, stallTimeout, noDebrief, notify, debriefOnly, adapter: adapterName }) => {
    const cwd = process.cwd();

    // Pre-loop signal hooks: if SIGINT/SIGTERM arrives before runRalphLoop
    // installs its own graceful-shutdown handlers (rare — only during
    // argv parsing or the kill-switch shortcut below), exit cleanly with
    // code 130. The loop's own handlers replace this once registered.
    let loopStarted = false;
    const earlyExit = (signal: string) => {
      if (loopStarted) return; // loop owns signal handling once started
      process.stderr.write(`\n${signal} received before loop start — exiting\n`);
      process.exit(130);
    };
    const earlySigint = () => earlyExit("SIGINT");
    const earlySigterm = () => earlyExit("SIGTERM");
    process.on("SIGINT", earlySigint);
    process.on("SIGTERM", earlySigterm);

    // --debrief-only: stub — log-directory discovery not yet implemented.
    if (debriefOnly) {
      process.stderr.write(
        "\x1b[33m⚠ --debrief-only is not yet implemented.\x1b[0m\n" +
        "  It requires discovering the most recent log file from the per-run log directory.\n" +
        "  The log directory convention is: <cwd>/.agent/autopilot-logs/<timestamp>.log\n" +
        "  To implement: read the most recent file from that directory and pass it to runDebrief.\n",
      );
      process.exit(1);
    }

    // Keep the loop's agent alive only if we plan to run a debrief — otherwise
    // shut it down inside the loop's own finally block.
    const willDebrief = shouldRunDebrief({ noDebrief, env: process.env as Record<string, string | undefined> });

    // Resolve config (project-level only, no plan path for loop)
    const resolvedConfig = resolveConfig(cwd);

    // Apply CLI flag overrides
    const config = applyCLIOverrides(resolvedConfig, {
      adapter: adapterName,
      stallTimeout,
      notify,
    }) as AutopilotConfig;

    // Create the adapter for this run
    const finalAdapterName = (config.adapter ?? DEFAULT_ADAPTER) as typeof DEFAULT_ADAPTER;
    const adapter = await createAdapter(finalAdapterName, config);

    const result = await runRalphLoop({
      prompt,
      cwd,
      maxIterations: maxIterations ?? undefined,
      timeoutMs: timeout ?? undefined,
      stallMs: config.stall_timeout ?? undefined,
      notifyUrl: config.notify_url ?? undefined,
      keepAlive: willDebrief,
      adapter,
      config,
    });

    // Loop has fully exited — remove pre-loop signal hooks so we don't
    // leak listeners across nested invocations (e.g., debrief).
    loopStarted = true; // suppress early-exit if a signal slipped in
    process.removeListener("SIGINT", earlySigint);
    process.removeListener("SIGTERM", earlySigterm);

    const icon =
      result.exitReason === "sentinel"
        ? "\x1b[32m✓\x1b[0m"
        : result.exitReason === "kill-switch"
          ? "\x1b[33m⊘\x1b[0m"
          : "\x1b[31m✗\x1b[0m";

    process.stdout.write(`\n${icon} ${result.message}\n`);
    process.stdout.write(`  Iterations: ${result.iterations}\n\n`);

    // Run debrief unless suppressed by flag or env var.
    if (willDebrief) {
      // Reuse the loop's agent handle if available; otherwise start a new one.
      const loopHandle = result.agentHandle;
      if (loopHandle) {
        try {
          await runDebrief({
            agentHandle: loopHandle,
            loopResult: result,
            prompt,
            cwd,
            config,
          });
        } catch {
          process.stderr.write("\x1b[33m⚠ Debrief failed (non-fatal)\x1b[0m\n");
        } finally {
          await loopHandle.adapter.shutdown(loopHandle.handle).catch(() => {});
        }
      } else {
        const debriefAdapter = await createAdapter((config.adapter ?? DEFAULT_ADAPTER) as typeof DEFAULT_ADAPTER, config);
        const debriefHandle = await debriefAdapter.start({ cwd });
        try {
          await runDebrief({
            agentHandle: { adapter: debriefAdapter, handle: debriefHandle },
            loopResult: result,
            prompt,
            cwd,
            config,
          });
        } catch {
          process.stderr.write("\x1b[33m⚠ Debrief agent failed to start (non-fatal)\x1b[0m\n");
        } finally {
          await debriefAdapter.shutdown(debriefHandle).catch(() => {});
        }
      }
    }

    if (result.exitReason !== "sentinel" && result.exitReason !== "kill-switch") {
      process.exit(1);
    }

    process.exit(0);
  },
});
