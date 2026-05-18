import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { EventStreamReader } from "@glrs-dev/autopilot";
import type { SessionEvent } from "@glrs-dev/autopilot";

interface EventTailProps {
  /** Absolute path to the event stream JSONL file. */
  eventFilePath: string;
  /** Maximum number of events to display (default: 20). */
  maxEvents?: number;
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return "??:??:??";
  }
}

function formatEventDetails(e: SessionEvent): string {
  switch (e.type) {
    case "session:start":
      return e.planPath ?? "";
    case "session:done":
      return e.exitReason ?? "";
    case "phase:start":
      return `${e.phase} (${e.current}/${e.total})`;
    case "phase:done":
      return `${e.phase}`;
    case "iteration:start":
      return `${e.iteration}/${e.maxIterations}`;
    case "iteration:done":
      return `${e.iteration} ${e.madeProgress ? "✓" : "—"}`;
    case "tool:call":
      return `${e.toolName} ${e.firstArg ?? ""}`;
    case "cost:update":
      return `$${e.cumulativeCostUsd.toFixed(3)}`;
    case "error":
      return e.message.slice(0, 60);
    case "enrich:start":
      return e.planPath ?? "";
    case "enrich:done":
      return `${e.filesProcessed} files`;
    case "verify:start":
      return `${e.itemCount} items`;
    case "verify:done":
      return `${e.passed} passed, ${e.failed} failed`;
    default:
      return "";
  }
}

/**
 * Live event tail — polls the event stream file at 500ms and shows the last N events.
 */
export function EventTail({ eventFilePath, maxEvents = 20 }: EventTailProps) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const offsetRef = useRef(0);

  useEffect(() => {
    const reader = new EventStreamReader(eventFilePath);

    const interval = setInterval(() => {
      const { events: newEvents, newOffset } = reader.readFrom(offsetRef.current);
      offsetRef.current = newOffset;
      if (newEvents.length > 0) {
        setEvents((prev) => [...prev, ...newEvents].slice(-maxEvents));
      }
    }, 500);

    return () => clearInterval(interval);
  }, [eventFilePath, maxEvents]);

  if (events.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Live Events</Text>
        <Text dimColor>  Waiting for events…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Live Events</Text>
      {events.map((e, i) => (
        <Text key={i} dimColor>
          {"  "}
          {formatTime(e.timestamp)} {e.type} {formatEventDetails(e)}
        </Text>
      ))}
    </Box>
  );
}
