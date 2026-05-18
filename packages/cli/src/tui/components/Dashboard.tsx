import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { SessionManager } from "../../session-manager.js";
import type { SessionHandle } from "@glrs-dev/autopilot";
import { SessionCard } from "./SessionCard.js";
import { NewSessionFlow } from "./NewSessionFlow.js";
import { SessionExpanded } from "./SessionExpanded.js";

type View =
  | { kind: "dashboard" }
  | { kind: "new-session" }
  | { kind: "expanded"; sessionId: string };

interface DashboardProps {
  manager: SessionManager;
}

export function Dashboard({ manager }: DashboardProps) {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<SessionHandle[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [view, setView] = useState<View>({ kind: "dashboard" });

  useEffect(() => {
    // Initial load
    setSessions(manager.getSessions());

    // Poll every 1s
    const interval = setInterval(() => {
      setSessions(manager.getSessions());
    }, 1000);

    return () => clearInterval(interval);
  }, [manager]);

  // All hooks must be called unconditionally (React rules of hooks).
  // Guard handler logic with a view check inside the callback.
  useInput((input, key) => {
    if (view.kind !== "dashboard") return;

    if (input === "q") {
      exit();
      return;
    }
    if (input === "n") {
      setView({ kind: "new-session" });
      return;
    }
    if (key.return && sessions[selectedIndex]) {
      setView({ kind: "expanded", sessionId: sessions[selectedIndex].id });
      return;
    }
    if (input === "k" && sessions[selectedIndex]) {
      manager.killSession(sessions[selectedIndex].id);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
    }
  });

  // Render sub-views (after all hooks)
  if (view.kind === "new-session") {
    return (
      <NewSessionFlow
        manager={manager}
        onDone={() => setView({ kind: "dashboard" })}
        onCancel={() => setView({ kind: "dashboard" })}
      />
    );
  }

  if (view.kind === "expanded") {
    const session = sessions.find((s) => s.id === view.sessionId);
    if (session) {
      return (
        <SessionExpanded
          handle={session}
          manager={manager}
          onBack={() => setView({ kind: "dashboard" })}
        />
      );
    }
    // Session no longer exists — fall back to dashboard on next render
    setView({ kind: "dashboard" });
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Autopilot Dashboard</Text>
        <Text dimColor>
          {" "}
          — {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </Text>
      </Box>

      {sessions.length === 0 ? (
        <Text dimColor>No active sessions. Press n to launch one, q to quit.</Text>
      ) : (
        sessions.map((session, i) => (
          <SessionCard
            key={session.id}
            handle={session}
            selected={i === selectedIndex}
          />
        ))
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter expand · n new · k kill · q quit</Text>
      </Box>
    </Box>
  );
}
