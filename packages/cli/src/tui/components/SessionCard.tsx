import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import type { SessionHandle, SessionStatus } from "@glrs-dev/autopilot";

interface SessionCardProps {
  handle: SessionHandle;
  selected: boolean;
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  running: "blue",
  enriching: "yellow",
  verifying: "cyan",
  complete: "green",
  error: "red",
  stale: "gray",
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: "Running",
  enriching: "Enriching",
  verifying: "Verifying",
  complete: "Complete",
  error: "Error",
  stale: "Stale",
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
  return `$${cost.toFixed(2)}`;
}

function repoName(cwd: string): string {
  return cwd.split("/").pop() || cwd;
}

export function SessionCard({ handle, selected }: SessionCardProps) {
  const color = STATUS_COLORS[handle.status];
  const isActive =
    handle.status === "running" ||
    handle.status === "enriching" ||
    handle.status === "verifying";

  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? "bold" : "single"}
      borderColor={selected ? color : undefined}
      paddingX={1}
      marginBottom={0}
    >
      {/* Line 1: repo + status */}
      <Box>
        <Text bold>{repoName(handle.cwd)}</Text>
        <Text> </Text>
        {isActive && <Spinner />}
        <Text color={color}> {STATUS_LABELS[handle.status]}</Text>
      </Box>

      {/* Line 2: phase + iteration */}
      <Box>
        {handle.currentPhase ? (
          <Text dimColor>
            Phase {handle.currentPhase.current}/{handle.currentPhase.total}:{" "}
            {handle.currentPhase.phase}
          </Text>
        ) : (
          <Text dimColor>—</Text>
        )}
        {handle.currentIteration && (
          <Text dimColor>
            {" "}
            · iter {handle.currentIteration.iteration}/{handle.currentIteration.max}
          </Text>
        )}
      </Box>

      {/* Line 3: cost + elapsed */}
      <Box>
        <Text dimColor>
          {formatCost(handle.cost)} · {formatElapsed(handle.startedAt)}
          {handle.totalIterations > 0 && ` · ${handle.totalIterations} iterations`}
        </Text>
      </Box>

      {/* Error line */}
      {handle.error && (
        <Box>
          <Text color="red">✗ {handle.error}</Text>
        </Box>
      )}
    </Box>
  );
}
