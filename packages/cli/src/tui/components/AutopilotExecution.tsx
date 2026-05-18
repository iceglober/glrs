/**
 * AutopilotExecution — full-viewport Ink TUI for live autopilot execution.
 *
 * Design direction: industrial/utilitarian — dense information, functional
 * color, log stream as the dominant element. Applies design-for-ai principles:
 *
 *   - One dominant element (the log stream — full width, most screen real estate)
 *   - Hierarchy through white space and weight, not uniform dimColor
 *   - Phase progress as a compact inline bar, not a vertical list
 *   - Stats shown once in header, not duplicated in a sidebar
 *   - Footer shows current activity (what the model is doing right now)
 *   - Functional color: green=done, yellow=active, red=error, dim=metadata
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │ ▶ plan-name [fast · GLM-5]                                    12m 34s  │
 *   │ [✓][✓][●][○][○]  enrich 9/9  $1.23  42K↑ 8K↓                          │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ 12:34:05 enrich wave_0.md → spec ✓                                     │
 *   │ 12:34:12 ⚙ file_edit src/auth.ts                                       │
 *   │ 12:34:15 💭 thinking… 8s · 2,140 chars                                 │
 *   │ ...                                                                     │
 *   ├─────────────────────────────────────────────────────────────────────────┤
 *   │ wave_2.yaml  iter 1/10  turns 4  retries 0                    Ctrl+C   │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * Renders to stderr so stdout remains clean for machine output.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useStdout, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import type { SessionEventEmitter } from "@glrs-dev/autopilot";
import type { SessionEvent } from "@glrs-dev/autopilot";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface PhaseEntry {
  name: string;
  status: "pending" | "running" | "complete" | "failed" | "skipped";
  iterations: number;
  cost: number;
}

interface LogEntry {
  time: string;
  text: string;
  color?: string;
}

interface ExecutionState {
  // Header
  planPath: string;
  startedAt: number;
  totalCost: number;
  // Cost tracking: cost:update events carry a per-source cumulative cost
  // (enrichment sessions vs execution session). When the source changes
  // (e.g., enrichment → execution), the cumulative resets to 0. We track
  // the last reported value to detect resets and accumulate correctly.
  _lastReportedCost: number;
  executionMode: "fast" | "deep" | "unknown";
  // Token counts — accumulated across messages. Per-message tokens grow
  // monotonically then reset on the next message; _lastMsg* tracks the
  // current message's latest value so we can detect the reset.
  tokensIn: number;
  tokensOut: number;
  _lastMsgTokensIn: number;
  _lastMsgTokensOut: number;
  cacheRead: number;
  cacheWrite: number;

  // Phases
  phases: PhaseEntry[];
  currentPhaseIndex: number;

  // Current iteration
  currentIteration: number;
  maxIterations: number;
  totalTurns: number; // cumulative tool calls across all phases
  retryCount: number;

  // Enrichment
  enriching: boolean;
  enrichedFiles: number;
  totalEnrichFiles: number;
  enrichDone: boolean;

  // Log stream
  logEntries: LogEntry[];

  // Errors
  lastError?: string;

  // Done
  done: boolean;
  exitReason?: string;
}

const MAX_LOG_ENTRIES = 5000;

function initialState(): ExecutionState {
  return {
    planPath: "",
    executionMode: "unknown",
    startedAt: Date.now(),
    totalCost: 0,
    _lastReportedCost: 0,
    tokensIn: 0,
    tokensOut: 0,
    _lastMsgTokensIn: 0,
    _lastMsgTokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    phases: [],
    currentPhaseIndex: -1,
    currentIteration: 0,
    maxIterations: 0,
    totalTurns: 0,
    retryCount: 0,
    enriching: false,
    enrichedFiles: 0,
    totalEnrichFiles: 0,
    enrichDone: false,
    logEntries: [],
    done: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
}

function planName(planPath: string): string {
  if (!planPath) return "";
  return path.basename(planPath);
}

function truncateArg(s: string, max = 40): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `…${s.slice(-(max - 1))}`;
}

function nowHHMMSS(): string {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function appendLog(
  entries: LogEntry[],
  text: string,
  color?: string,
): LogEntry[] {
  const entry: LogEntry = { time: nowHHMMSS(), text, color };
  return [...entries, entry].slice(-MAX_LOG_ENTRIES);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AutopilotExecutionProps {
  emitter: SessionEventEmitter;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AutopilotExecution({ emitter }: AutopilotExecutionProps) {
  const [state, setState] = useState<ExecutionState>(initialState);
  const [elapsedMs, setElapsedMs] = useState(0);
  const { stdout } = useStdout();

  // Force re-render on terminal resize so layout reflows to new dimensions.
  // Ink's useStdout does NOT re-render on resize — stdout.columns/rows update
  // silently, leaving the layout pinned to stale dimensions until the next
  // state change. Bumping a counter on the "resize" event fixes this.
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => setResizeTick((n) => n + 1);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Subscribe to emitter events — unconditional hook
  useEffect(() => {
    const handler = (event: SessionEvent) => {
      setState((prev) => applyEvent(prev, event));
    };
    emitter.on("event", handler);
    return () => {
      emitter.off("event", handler);
    };
  }, [emitter]);

  // Elapsed time ticker — unconditional hook
  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        setElapsedMs(Date.now() - prev.startedAt);
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Scroll state: null = pinned to bottom (auto-scroll), number = manual offset from top
  const [scrollOffset, setScrollOffset] = useState<number | null>(null);

  // Keyboard input for scrolling and copy
  useInput((input, key) => {
    // Ctrl+C: propagate to the abort handler (don't swallow it)
    if (input === "c" && key.ctrl) {
      // Let the SIGINT handler in autopilot-tui.ts handle this
      process.kill(process.pid, "SIGINT");
      return;
    }

    const totalEntries = state.logEntries.length;
    const termH = (stdout as NodeJS.WriteStream & { rows?: number }).rows ?? 24;
    const viewHeight = Math.max(4, termH - 8);

    if (key.upArrow || input === "k") {
      // Scroll up
      setScrollOffset((prev) => {
        const current = prev ?? Math.max(0, totalEntries - viewHeight);
        return Math.max(0, current - 1);
      });
    } else if (key.downArrow || input === "j") {
      // Scroll down
      setScrollOffset((prev) => {
        const current = prev ?? Math.max(0, totalEntries - viewHeight);
        const maxOffset = Math.max(0, totalEntries - viewHeight);
        const next = Math.min(maxOffset, current + 1);
        // If we've scrolled back to the bottom, re-pin
        return next >= maxOffset ? null : next;
      });
    } else if (input === "G") {
      // Jump to bottom (re-pin)
      setScrollOffset(null);
    } else if (input === "g") {
      // Jump to top
      setScrollOffset(0);
    } else if (input === "c") {
      // Copy log contents to clipboard
      const text = state.logEntries.map((e) => `${e.time} ${e.text}`).join("\n");
      // Use pbcopy on macOS, xclip on Linux
      const proc = require("node:child_process").spawn(
        process.platform === "darwin" ? "pbcopy" : "xclip",
        process.platform === "darwin" ? [] : ["-selection", "clipboard"],
        { stdio: ["pipe", "ignore", "ignore"] },
      );
      proc.stdin.write(text);
      proc.stdin.end();
    }
  });

  const termWidth = stdout.columns ?? 80;

  const {
    planPath,
    totalCost,
    tokensIn,
    tokensOut,
    executionMode,
    phases,
    currentPhaseIndex,
    currentIteration,
    maxIterations,
    totalTurns,
    retryCount,
    enriching,
    enrichedFiles,
    totalEnrichFiles,
    enrichDone,
    logEntries,
    lastError,
    done,
    exitReason,
  } = state;

  const elapsed = formatElapsed(elapsedMs);
  const costStr = formatCost(totalCost);
  const tokInStr = formatTokens(tokensIn);
  const tokOutStr = formatTokens(tokensOut);
  const name = planName(planPath);

  // Log stream gets all vertical space minus header (3 lines) + footer (1 line) + borders (4 lines)
  const termHeight = (stdout as NodeJS.WriteStream & { rows?: number }).rows ?? 24;
  const logHeight = Math.max(4, termHeight - 8);

  // Scrollable log: null offset = pinned to bottom, number = manual scroll position
  const visibleLogs = scrollOffset === null
    ? logEntries.slice(-logHeight)
    : logEntries.slice(scrollOffset, scrollOffset + logHeight);
  const isPinned = scrollOffset === null;
  const scrollIndicator = !isPinned ? ` ↑${scrollOffset}/${logEntries.length}` : "";

  // Phase progress bar: compact inline [✓][✓][●][○][○]
  const phaseBar = phases.map((p, i) => {
    const icon =
      p.status === "complete" ? "✓"
      : p.status === "failed" ? "✗"
      : p.status === "running" ? "●"
      : p.status === "skipped" ? "—"
      : "○";
    const color =
      p.status === "complete" ? "green"
      : p.status === "failed" ? "red"
      : p.status === "running" ? "yellow"
      : undefined;
    return (
      <Text key={`phase-${i}`} color={color} dimColor={!color}>
        {icon}
      </Text>
    );
  });

  // Current phase name for footer
  const currentPhaseName =
    currentPhaseIndex >= 0 && phases[currentPhaseIndex]
      ? phases[currentPhaseIndex]!.name
      : "";

  // Status icon for header
  const statusIcon = done
    ? exitReason === "sentinel" ? <Text color="green" bold>✓</Text> : <Text color="red" bold>✗</Text>
    : enriching
      ? <Text color="yellow">◐</Text>
      : <Text color="cyan" bold>▶</Text>;

  // Enrichment status (compact, for header row 2)
  const enrichStr = enriching
    ? `enrich ${enrichedFiles}/${totalEnrichFiles}`
    : enrichDone
      ? `enrich ✓`
      : "";

  // Inner width (accounting for border + padding on each side)
  const innerWidth = Math.max(20, termWidth - 4);

  return (
    <Box flexDirection="column" width={termWidth}>
      {/* ── Header row 1: status + plan name + elapsed ── */}
      <Box
        borderStyle="single"
        borderTop
        borderLeft
        borderRight
        borderBottom={false}
        borderColor="gray"
        paddingX={1}
      >
        <Box flexGrow={1}>
          {statusIcon}
          <Text bold> {name || "autopilot"}</Text>
          {executionMode !== "unknown" && (
            <Text dimColor> {executionMode === "fast" ? "fast" : "deep"}</Text>
          )}
        </Box>
        <Text>{elapsed}</Text>
      </Box>

      {/* ── Header row 2: phases + enrichment + cost + tokens ── */}
      <Box
        borderStyle="single"
        borderTop={false}
        borderLeft
        borderRight
        borderBottom
        borderColor="gray"
        paddingX={1}
        gap={2}
      >
        {/* Phase progress bar */}
        {phases.length > 0 && (
          <Box gap={0}>
            {phaseBar}
            {currentPhaseName && (
              <Text dimColor> {currentPhaseName}</Text>
            )}
          </Box>
        )}
        {phases.length === 0 && !enriching && (
          <Text dimColor>starting…</Text>
        )}

        {/* Enrichment */}
        {enrichStr && (
          <Text color={enriching ? "yellow" : "green"}>{enrichStr}</Text>
        )}

        {/* Spacer */}
        <Box flexGrow={1} />

        {/* Cost + tokens */}
        <Text color="yellow">{costStr}</Text>
        <Text dimColor>{tokInStr}↑ {tokOutStr}↓</Text>
      </Box>

      {/* ── Log stream (dominant element — full width) ── */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderTop={false}
        borderLeft
        borderRight
        borderBottom={false}
        borderColor="gray"
        paddingX={1}
        height={logHeight + 2}
      >
        {visibleLogs.length === 0 && (
          <Text dimColor>waiting for events…</Text>
        )}
        {visibleLogs.map((entry, i) => (
          <LogRow key={`${entry.time}-${i}`} entry={entry} maxWidth={innerWidth} />
        ))}
      </Box>

      {/* ── Footer: current activity + controls ── */}
      <Box
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Box gap={2}>
          {/* Error takes priority */}
          {lastError && (
            <Text color="red">✗ {lastError.length > innerWidth - 20 ? lastError.slice(0, innerWidth - 23) + "…" : lastError}</Text>
          )}
          {/* Done state */}
          {done && !lastError && (
            exitReason === "sentinel"
              ? <Text color="green">✓ complete · {costStr} · {totalTurns} tool calls</Text>
              : <Text color="red">✗ {exitReason ?? "stopped"}</Text>
          )}
          {/* Active state */}
          {!done && !lastError && (
            <>
              {currentPhaseName && (
                <Text bold>{currentPhaseName}</Text>
              )}
              {maxIterations > 0 && (
                <Text dimColor>iter {currentIteration}/{maxIterations}</Text>
              )}
              {totalTurns > 0 && (
                <Text dimColor>turns {totalTurns}</Text>
              )}
              {retryCount > 0 && (
                <Text color="yellow">retries {retryCount}</Text>
              )}
              {enriching && (
                <Spinner />
              )}
            </>
          )}
        </Box>
        <Text dimColor>{scrollIndicator ? scrollIndicator + "  " : ""}c:copy ↑↓:scroll  Ctrl+C</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface LogRowProps {
  entry: LogEntry;
  maxWidth: number;
}

function LogRow({ entry, maxWidth }: LogRowProps) {
  // timestamp is 8 chars + 1 space = 9 chars prefix
  const textMax = Math.max(10, maxWidth - 9);
  const text =
    entry.text.length > textMax
      ? entry.text.slice(0, textMax - 1) + "…"
      : entry.text;

  return (
    <Box>
      <Text dimColor>{entry.time} </Text>
      <Text color={entry.color as Parameters<typeof Text>[0]["color"]}>{text}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// State reducer — pure function, no hooks
// ---------------------------------------------------------------------------

function applyEvent(prev: ExecutionState, event: SessionEvent): ExecutionState {
  switch (event.type) {
    case "session:start":
      return {
        ...prev,
        planPath: event.planPath,
        startedAt: Date.now(),
        executionMode: event.fast ? "fast" : "deep",
        logEntries: appendLog(prev.logEntries, `session started (enrich: ${event.enrichModel ?? "prime"} · execute: ${event.executeModel ?? "build"})`),
      };

    case "enrich:start":
      return {
        ...prev,
        enriching: true,
        totalEnrichFiles: event.fileCount,
        enrichedFiles: 0,
        logEntries: appendLog(
          prev.logEntries,
          `enrichment started (${event.fileCount} files)`,
          "yellow",
        ),
      };

    case "enrich:file:start":
      return {
        ...prev,
        logEntries: appendLog(prev.logEntries, `enriching ${event.file}…`),
      };

    case "enrich:file:done": {
      const specRef = event.specFile ? ` → ${event.specFile}` : "";
      return {
        ...prev,
        enrichedFiles: prev.enrichedFiles + 1,
        logEntries: appendLog(
          prev.logEntries,
          `✓ ${event.file}${specRef}`,
          "green",
        ),
      };
    }

    case "enrich:file:skip":
      return {
        ...prev,
        // Count skipped files toward the enrichment progress so the
        // counter reflects total files processed, not just enriched.
        enrichedFiles: prev.enrichedFiles + 1,
        logEntries: appendLog(
          prev.logEntries,
          `${event.file} skipped: ${event.reason}`,
          "yellow",
        ),
      };

    case "enrich:file:error":
      return {
        ...prev,
        enrichedFiles: prev.enrichedFiles + 1,
        logEntries: appendLog(
          prev.logEntries,
          `✗ ${event.file}: ${event.error}`,
          "red",
        ),
      };

    case "enrich:done":
      return {
        ...prev,
        enriching: false,
        enrichDone: true,
        logEntries: appendLog(prev.logEntries, "enrichment complete", "green"),
      };

    case "phase:start": {
      if (event.current === 0) {
        // Plan-loaded info event — initialise phases array from total count.
        const phases: PhaseEntry[] = Array.from({ length: event.total }, () => ({
          name: "",
          status: "pending" as const,
          iterations: 0,
          cost: 0,
        }));
        return {
          ...prev,
          phases,
          logEntries: appendLog(
            prev.logEntries,
            `plan loaded: ${event.total} phases`,
          ),
        };
      }

      // Real phase start (1-based index)
      const phaseIdx = event.current - 1;
      let phases = prev.phases.map((p, i): PhaseEntry => {
        if (i === phaseIdx) {
          return { ...p, name: event.phase, status: "running" };
        }
        return p;
      });
      // Grow if needed
      if (phaseIdx >= phases.length) {
        const grown = [...prev.phases];
        while (grown.length <= phaseIdx) {
          grown.push({ name: "", status: "pending", iterations: 0, cost: 0 });
        }
        grown[phaseIdx] = { name: event.phase, status: "running", iterations: 0, cost: 0 };
        phases = grown;
      }
      return {
        ...prev,
        phases,
        currentPhaseIndex: phaseIdx,
        logEntries: appendLog(
          prev.logEntries,
          `phase:start ${event.phase} ${event.current}/${event.total}`,
        ),
      };
    }

    case "phase:done": {
      const phases = prev.phases.map((p): PhaseEntry => {
        if (p.name === event.phase) {
          return {
            ...p,
            status: event.completed ? "complete" : "failed",
            iterations: event.iterations,
            cost: event.costUsd,
          };
        }
        return p;
      });
      const statusIcon = event.completed ? "✓" : "✗";
      return {
        ...prev,
        phases,
        logEntries: appendLog(
          prev.logEntries,
          `phase:done ${event.phase} ${statusIcon} (${event.iterations} iter, ${formatCost(event.costUsd)})`,
          event.completed ? "green" : "red",
        ),
      };
    }

    case "iteration:start":
      return {
        ...prev,
        currentIteration: event.iteration,
        maxIterations: event.maxIterations,
        logEntries: appendLog(
          prev.logEntries,
          `iter ${event.iteration}/${event.maxIterations} start`,
        ),
      };

    case "iteration:done": {
      const dur = formatDuration(event.durationMs);
      const costPart = event.costUsd != null ? ` ${formatCost(event.costUsd)}` : "";
      const filesPart =
        event.filesChanged != null ? ` ${event.filesChanged} files` : "";
      return {
        ...prev,
        logEntries: appendLog(
          prev.logEntries,
          `iter ${event.iteration} done ${dur}${costPart}${filesPart}`,
        ),
      };
    }

    case "tool:call": {
      const argStr = event.firstArg ? ` ${truncateArg(event.firstArg)}` : "";
      return {
        ...prev,
        totalTurns: prev.totalTurns + 1,
        logEntries: appendLog(
          prev.logEntries,
          `⚙ ${event.toolName}${argStr}`,
        ),
      };
    }

    case "thinking": {
      // Show a "thinking…" indicator that updates in-place (replaces
      // the previous thinking entry instead of appending a new line).
      const label = event.elapsedSec < 60
        ? `💭 thinking… ${event.elapsedSec}s · ${event.chars} chars`
        : `💭 thinking… ${Math.floor(event.elapsedSec / 60)}m${(event.elapsedSec % 60).toString().padStart(2, "0")}s · ${event.chars} chars`;
      const entries = [...prev.logEntries];
      const lastIdx = entries.length - 1;
      if (lastIdx >= 0 && entries[lastIdx]!.text.startsWith("💭 thinking")) {
        // Replace in-place
        entries[lastIdx] = { ...entries[lastIdx]!, text: label };
      } else {
        // First thinking entry in this block
        const now = nowHHMMSS();
        entries.push({ time: now, text: label });
        if (entries.length > MAX_LOG_ENTRIES) entries.shift();
      }
      return { ...prev, logEntries: entries };
    }

    case "cost:update": {
      // Cost: the event carries a per-source cumulative cost (enrichment
      // sessions sum independently from the execution session). When the
      // source changes, the cumulative resets. Detect the reset and
      // accumulate correctly.
      const reportedCost = event.cumulativeCostUsd;
      let newCost = prev.totalCost;
      if (reportedCost < prev._lastReportedCost) {
        // Source changed (e.g., enrichment → execution) — bank previous total
        newCost = prev.totalCost + reportedCost;
      } else {
        // Same source — replace delta
        newCost = prev.totalCost - prev._lastReportedCost + reportedCost;
      }

      // Token counts from the adapter are per-message (grow within a
      // message, reset to 0 on the next message). Detect the reset
      // (current < previous) and accumulate the previous message's
      // final count into a running total.
      let newIn = prev.tokensIn;
      let newOut = prev.tokensOut;
      if (event.tokensIn != null) {
        if (event.tokensIn < prev._lastMsgTokensIn) {
          // New message started — bank the previous message's tokens
          newIn = prev.tokensIn + event.tokensIn;
        } else {
          // Same message — replace with the larger value
          newIn = prev.tokensIn - prev._lastMsgTokensIn + event.tokensIn;
        }
      }
      if (event.tokensOut != null) {
        if (event.tokensOut < prev._lastMsgTokensOut) {
          newOut = prev.tokensOut + event.tokensOut;
        } else {
          newOut = prev.tokensOut - prev._lastMsgTokensOut + event.tokensOut;
        }
      }
      return {
        ...prev,
        totalCost: newCost,
        _lastReportedCost: reportedCost,
        tokensIn: newIn,
        tokensOut: newOut,
        _lastMsgTokensIn: event.tokensIn ?? prev._lastMsgTokensIn,
        _lastMsgTokensOut: event.tokensOut ?? prev._lastMsgTokensOut,
      };
    }

    case "error":
      return {
        ...prev,
        lastError: event.message,
        logEntries: appendLog(prev.logEntries, `✗ ${event.message}`, "red"),
      };

    case "credential:expired":
      return {
        ...prev,
        lastError: `Credentials expired (${event.provider}). Run gs-assume to refresh.`,
        logEntries: appendLog(
          prev.logEntries,
          `✗ credentials expired (${event.provider})`,
          "red",
        ),
      };

    case "verify:start":
      return {
        ...prev,
        logEntries: appendLog(
          prev.logEntries,
          `verify:start ${event.itemCount} commands`,
        ),
      };

    case "verify:result":
      return {
        ...prev,
        logEntries: appendLog(
          prev.logEntries,
          `verify ${event.passed ? "✓" : "✗"} ${event.command}`,
          event.passed ? "green" : "red",
        ),
      };

    case "verify:done":
      return {
        ...prev,
        logEntries: appendLog(
          prev.logEntries,
          `verify done: ${event.passed}/${event.passed + event.failed}`,
          event.failed === 0 ? "green" : "red",
        ),
      };

    case "session:done":
      return {
        ...prev,
        done: true,
        exitReason: event.exitReason,
        totalCost: event.cumulativeCostUsd ?? prev.totalCost,
        logEntries: appendLog(
          prev.logEntries,
          `session done: ${event.exitReason}`,
          event.exitReason === "sentinel" ? "green" : "yellow",
        ),
      };

    default:
      return prev;
  }
}
