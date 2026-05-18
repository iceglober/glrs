/**
 * CLI renderer for the autopilot event stream.
 *
 * Subscribes to a SessionEventEmitter (Channel 1) and writes formatted
 * text to stderr, preserving the existing user experience while the
 * architecture changes underneath.
 *
 * Maps each SessionEvent type to the current stderr output format:
 *   - session:start → nothing (the caller already prints the banner)
 *   - enrich:* → progress lines matching the current enrichment output
 *   - phase:start → "→ Phase N/M: <file>"
 *   - iteration:start → "Iteration N/M"
 *   - tool:call → "  tool: <name> <arg>"
 *   - iteration:done → "  ✓ Iteration N done (<duration>, <cost>)"
 *   - verify:start/result/done → verify progress lines
 *   - error → "  ✗ <message>"
 *   - credential:expired → actionable message
 *   - session:done → nothing (the caller prints the completion summary)
 */

import type { SessionEventEmitter } from "@glrs-dev/autopilot";
import type { SessionEvent } from "@glrs-dev/autopilot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms / 1000) % 60);
  return `${min}m ${sec}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// createCliRenderer
// ---------------------------------------------------------------------------

/**
 * Subscribe to `emitter` and write formatted text to stderr.
 * Returns an `unsubscribe()` function that removes all listeners.
 *
 * This function is intentionally side-effect-free on construction —
 * it only writes to stderr when events arrive.
 */
export function createCliRenderer(emitter: SessionEventEmitter): { unsubscribe: () => void } {
  const handler = (event: SessionEvent) => {
    switch (event.type) {
      // Lifecycle — session:start and session:done are handled by the caller
      case "session:start":
      case "session:done":
        break;

      // Enrichment
      case "enrich:start":
        // The caller (autopilot-cmd.ts) already prints the enrichment banner
        break;

      case "enrich:file:start":
        // Progress is shown via tool:call events during enrichment
        break;

      case "enrich:file:done":
        process.stderr.write(
          `  ✓ ${event.file}${event.specFile ? ` → ${event.specFile}` : ""} generated\n`,
        );
        break;

      case "enrich:file:skip":
        process.stderr.write(`  ${event.file} — ${event.reason}\n`);
        break;

      case "enrich:file:error":
        process.stderr.write(`  ✗ ${event.file}: ${event.error}\n`);
        break;

      case "enrich:done":
        // The caller prints the "✓ Plan enriched" line
        break;

      // Execution — phase
      case "phase:start":
        if (event.current === 0) {
          // Plan loading info (not a real phase)
          process.stderr.write(`\n\x1b[2m${event.phase}\x1b[0m\n`);
        } else {
          process.stderr.write(
            `\n\x1b[1m→ Phase ${event.current}/${event.total}: ${event.phase}\x1b[0m\n`,
          );
        }
        break;

      case "phase:done":
        if (event.iterations === 0 && event.completed) {
          // Phase was already complete — skipped
          process.stderr.write(
            `  \x1b[2m✓ ${event.phase} — skipped (already done)\x1b[0m\n`,
          );
        } else if (event.completed) {
          process.stderr.write(
            `  ✓ Phase ${event.phase} complete (${event.iterations} iteration(s), ${formatCost(event.costUsd)})\n`,
          );
        } else {
          process.stderr.write(
            `  ✗ Phase ${event.phase} did not complete (${event.iterations} iteration(s))\n`,
          );
        }
        break;

      // Execution — iteration
      case "iteration:start": {
        const laneTag = event.laneId ? `[${event.laneId}] ` : "";
        process.stderr.write(`\n${laneTag}Iteration ${event.iteration}/${event.maxIterations} `);
        break;
      }

      case "iteration:done": {
        const laneTag = event.laneId ? `[${event.laneId}] ` : "";
        const dur = formatDuration(event.durationMs);
        const costPart = event.costUsd && event.costUsd > 0 ? ` · ${formatCost(event.costUsd)}` : "";
        const cumulPart = event.cumulativeCostUsd && event.cumulativeCostUsd > 0 ? ` (total: ${formatCost(event.cumulativeCostUsd)})` : "";
        const filesPart = event.filesChanged ? ` · ${event.filesChanged} file(s) changed` : "";
        const progressPart = event.madeProgress === false ? " · \x1b[33mno progress\x1b[0m" : "";
        process.stderr.write(
          `\n  ${laneTag}✓ Iteration ${event.iteration} done (${dur}${costPart}${cumulPart}${filesPart}${progressPart})\n`,
        );
        if (event.commitSubject) {
          process.stderr.write(`  commit: ${event.commitSubject}\n`);
        }
        break;
      }

      case "tool:call": {
        const laneTag = event.laneId ? `[${event.laneId}] ` : "";
        const argPart = event.firstArg ? ` ${event.firstArg}` : "";
        // Overwrite the current line with the latest tool call (activity indicator)
        if (process.stderr.isTTY) {
          process.stderr.write(`\r\x1b[K  ${laneTag}⚙ ${event.toolName}${argPart}`);
        } else {
          process.stderr.write(`  ${laneTag}⚙ ${event.toolName}${argPart}\n`);
        }
        break;
      }

      case "cost:update":
        // Show cumulative cost as a live indicator on TTY
        if (process.stderr.isTTY && event.cumulativeCostUsd > 0) {
          process.stderr.write(`\r\x1b[K  💰 ${formatCost(event.cumulativeCostUsd)}`);
        }
        break;

      // Errors
      case "error":
        process.stderr.write(`\n\x1b[31m✗ Error: ${event.message}\x1b[0m\n`);
        break;

      case "credential:expired":
        process.stderr.write(
          `\n\x1b[31m✗ Credentials expired (${event.provider}).\x1b[0m\n` +
            `  Run \`gs-assume\` and then \`glrs oc autopilot --resume\`.\n`,
        );
        break;

      // Verify
      case "verify:start":
        process.stderr.write(
          `  Running ${event.itemCount} verify command(s) for ${event.phase}...\n`,
        );
        break;

      case "verify:result":
        if (event.passed) {
          process.stderr.write(`  ✓ ${event.itemId}: ${event.command}\n`);
        } else {
          process.stderr.write(`  ✗ ${event.itemId}: ${event.command}\n`);
          if (event.stderr) {
            process.stderr.write(`    ${event.stderr.split("\n").join("\n    ")}\n`);
          }
        }
        break;

      case "verify:done":
        if (event.failed === 0) {
          process.stderr.write(
            `  ✓ All ${event.passed} verify command(s) passed\n`,
          );
        } else {
          process.stderr.write(
            `  ✗ ${event.failed} verify command(s) failed (${event.passed} passed)\n`,
          );
        }
        break;

      case "thinking":
        // Show thinking indicator on TTY (overwrites current line)
        if (process.stderr.isTTY) {
          const dur = event.elapsedSec < 60
            ? `${event.elapsedSec}s`
            : `${Math.floor(event.elapsedSec / 60)}m${(event.elapsedSec % 60).toString().padStart(2, "0")}s`;
          process.stderr.write(`\r\x1b[K  💭 thinking… ${dur} · ${event.chars} chars`);
        }
        break;
    }
  };

  emitter.on("event", handler);

  return {
    unsubscribe: () => {
      emitter.off("event", handler);
    },
  };
}
