import React from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import type { SessionHandle, SessionStatus } from "@glrs-dev/autopilot";
import type { SessionManager } from "../../session-manager.js";
import { PhaseTree } from "./PhaseTree.js";
import { EventTail } from "./EventTail.js";
import * as path from "node:path";

interface SessionExpandedProps {
  handle: SessionHandle;
  manager: SessionManager;
  onBack: () => void;
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  running: "blue",
  enriching: "yellow",
  verifying: "cyan",
  complete: "green",
  error: "red",
  stale: "gray",
};

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(3)}`;
}

function repoName(cwd: string): string {
  return cwd.split("/").pop() || cwd;
}

/**
 * Expanded view for a single session.
 * Shows phase progress, live event tail, cost/elapsed summary, and error display.
 * Keyboard: esc (back), k (kill), r (retry), c (cleanup).
 */
export function SessionExpanded({ handle, manager, onBack }: SessionExpandedProps) {
  const isActive =
    handle.status === "running" ||
    handle.status === "enriching" ||
    handle.status === "verifying";

  const isTerminal =
    handle.status === "complete" ||
    handle.status === "error" ||
    handle.status === "stale";

  const color = STATUS_COLORS[handle.status];

  const eventFilePath = path.join(handle.cwd, ".agent", "autopilot-events.jsonl");

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (input === "k") {
      manager.killSession(handle.id);
      return;
    }
    if (input === "r" && isTerminal) {
      manager.retrySession(handle.id);
      onBack();
      return;
    }
    if (input === "c" && isTerminal) {
      manager.cleanupSession(handle.id);
      onBack();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="single">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Session: {repoName(handle.cwd)}</Text>
        <Text> </Text>
        {isActive && <Spinner />}
        <Text color={color}> {handle.status}</Text>
      </Box>

      {/* Phase progress */}
      <Box marginBottom={1}>
        <PhaseTree handle={handle} />
      </Box>

      {/* Summary */}
      <Box marginBottom={1}>
        <Text bold>Summary</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          Cost: {formatCost(handle.cost)} · Elapsed: {formatElapsed(handle.startedAt)}
          {handle.totalIterations > 0 && ` · ${handle.totalIterations} iterations`}
        </Text>
      </Box>

      {/* Error display */}
      {handle.error && (
        <Box marginBottom={1}>
          <Text color="red">✗ Error: {handle.error}</Text>
        </Box>
      )}

      {/* Live event tail */}
      <Box marginBottom={1}>
        <EventTail eventFilePath={eventFilePath} />
      </Box>

      {/* Key hints */}
      <Box marginTop={1}>
        <Text dimColor>
          esc back · k kill
          {isTerminal ? " · r retry · c cleanup" : ""}
        </Text>
      </Box>
    </Box>
  );
}
