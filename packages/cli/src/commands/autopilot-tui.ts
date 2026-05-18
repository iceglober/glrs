import React from "react";
import { render } from "ink";
import { AutopilotPicker } from "../tui/components/AutopilotPicker.js";
import { AutopilotExecution } from "../tui/components/AutopilotExecution.js";
import { SessionRunner } from "@glrs-dev/autopilot";
import type { AgentAdapter } from "@glrs-dev/autopilot";
import { createAdapter, DEFAULT_ADAPTER, type AdapterName } from "../adapter-factory.js";
import { resolveConfig } from "../autopilot/config-reader.js";

/**
 * `glrs autopilot` — TUI plan picker at cwd, then run the autopilot session
 * with live event rendering to stderr.
 */
export async function runAutopilot(adapterName?: AdapterName): Promise<void> {
  const cwd = process.cwd();

  if (!process.stderr.isTTY) {
    process.stderr.write("glrs autopilot requires a TTY.\n");
    process.exit(1);
  }

  // Step 1: Pick a plan via the TUI file explorer
  const planPath = await pickPlan(cwd);
  if (!planPath) {
    // User cancelled
    return;
  }

  // Step 2: Resolve config (before creating adapter)
  const config = resolveConfig(cwd, planPath);

  // CLI parameter overrides config
  if (adapterName) {
    config.adapter = adapterName as "opencode" | "claude-code-cli";
  }

  // Step 3: Create the runner (events emitter is available before run())
  const adapter: AgentAdapter = await createAdapter(config.adapter ?? DEFAULT_ADAPTER, config);

  const runner = new SessionRunner({
    planPath,
    cwd,
    fast: true,
    adapter,
  });

  // Step 4: Mount the full-viewport TUI — it subscribes to runner.events.
  // exitOnCtrlC: false so we can handle Ctrl+C gracefully (first press
  // triggers a checkpoint write; second press force-exits).
  const app = render(
    React.createElement(AutopilotExecution, { emitter: runner.events }),
    { stdout: process.stderr, exitOnCtrlC: false },
  );

  // Wire SIGINT: first press → graceful abort (checkpoint), second → force-exit
  const sigintHandler = () => {
    runner.abort();
  };
  process.on("SIGINT", sigintHandler);

  // Give React one tick to mount and subscribe to the emitter
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  try {
    // Step 5: Run the autopilot — the TUI updates live as events arrive
    await runner.run();

    // Step 6: Give the user 2 seconds to read the completion summary, then exit
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n\x1b[31m✗ Fatal error: ${message}\x1b[0m\n`);
  } finally {
    process.removeListener("SIGINT", sigintHandler);
    app.unmount();
    app.clear();
  }
}

/**
 * Show the Ink file explorer and return the selected plan path, or null if cancelled.
 */
function pickPlan(startDir: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const app = render(
      React.createElement(AutopilotPicker, {
        startDir,
        onSelect: (planPath: string) => {
          app.unmount();
          app.clear();
          resolve(planPath);
        },
        onCancel: () => {
          app.unmount();
          app.clear();
          resolve(null);
        },
      }),
      { stdout: process.stderr, exitOnCtrlC: true },
    );
  });
}
