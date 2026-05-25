/**
 * Lightweight stderr renderer for `glrs loop`.
 *
 * Subscribes to the SessionEventEmitter and writes human-readable lines
 * to stderr so the user gets at-least-once-per-minute feedback without
 * the full Ink TUI.
 */

import type { SessionEventEmitter } from "@glrs-dev/autopilot";
import type { SessionEvent } from "@glrs-dev/autopilot";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

function ts(): string {
  const d = new Date();
  return `${DIM}${d.toLocaleTimeString()}${RESET}`;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * Attach a stderr renderer to the given emitter. Returns a detach function.
 */
export function attachStderrRenderer(emitter: SessionEventEmitter): () => void {
  let lastOutputAt = Date.now();
  let toolCallsSinceLastLine = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let currentIteration = 0;
  let iterationStartedAt = 0;

  const write = (line: string) => {
    process.stderr.write(line + "\n");
    lastOutputAt = Date.now();
  };

  const handler = (event: SessionEvent) => {
    switch (event.type) {
      case "iteration:start":
        currentIteration = event.iteration;
        iterationStartedAt = Date.now();
        toolCallsSinceLastLine = 0;
        write(`${ts()} ${CYAN}▶${RESET} Iteration ${event.iteration}/${event.maxIterations}`);
        break;

      case "tool:call":
        toolCallsSinceLastLine++;
        // Print every tool call — this is the primary "alive" signal
        write(`${ts()}   ${DIM}tool:${RESET} ${event.toolName}${event.firstArg ? " " + event.firstArg : ""}`);
        break;

      case "thinking":
        // Only print if we haven't written anything in 30s
        if (Date.now() - lastOutputAt >= 30_000) {
          write(`${ts()}   ${DIM}thinking${RESET} (${event.elapsedSec}s, ${event.chars} chars)`);
        }
        break;

      case "iteration:done": {
        const dur = formatDuration(event.durationMs);
        const progress = event.madeProgress ? `${GREEN}progress${RESET}` : `${YELLOW}no progress${RESET}`;
        const cost = event.costUsd ? ` · $${event.costUsd.toFixed(2)}` : "";
        const files = event.filesChanged ? ` · ${event.filesChanged} files` : "";
        const commit = event.commitSubject ? `\n${ts()}   ${DIM}commit:${RESET} ${event.commitSubject}` : "";
        write(`${ts()} ${GREEN}✓${RESET} Iteration ${event.iteration} done (${dur}, ${progress}${files}${cost})${commit}`);
        break;
      }

      case "cost:update":
        // Only print cost updates if nothing else has printed in 45s
        if (Date.now() - lastOutputAt >= 45_000 && event.cumulativeCostUsd > 0) {
          write(`${ts()}   ${DIM}cost:${RESET} $${event.cumulativeCostUsd.toFixed(2)}`);
        }
        break;

      case "error":
        write(`${ts()} ${RED}✗${RESET} Error: ${event.message}`);
        break;

      case "credential:expired":
        write(`${ts()} ${RED}✗${RESET} Credentials expired (${event.provider}): ${event.message}`);
        break;

      case "phase:start":
        write(`${ts()} ${CYAN}▶${RESET} Phase ${event.current}/${event.total}: ${event.phase}`);
        break;

      case "phase:done": {
        const status = event.completed ? `${GREEN}✓${RESET}` : `${YELLOW}partial${RESET}`;
        write(`${ts()} ${status} Phase done: ${event.phase} (${event.iterations} iters, $${event.costUsd.toFixed(2)})`);
        break;
      }
    }
  };

  emitter.on("event", handler);

  // Heartbeat: if nothing has been written in 60s, print a status line
  heartbeatTimer = setInterval(() => {
    const silenceMs = Date.now() - lastOutputAt;
    if (silenceMs >= 55_000) {
      const elapsed = currentIteration > 0 && iterationStartedAt > 0
        ? formatDuration(Date.now() - iterationStartedAt)
        : "?";
      write(`${ts()}   ${DIM}alive${RESET} — iteration ${currentIteration}, elapsed ${elapsed}, ${toolCallsSinceLastLine} tool calls`);
      toolCallsSinceLastLine = 0;
    }
  }, 55_000);

  return () => {
    emitter.off("event", handler);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
}
