/**
 * stall-detector — watchdog timer that nudges stalled agents.
 *
 * The stall pattern: model generates text describing what it'll do next
 * ("Let me check X", "Now I'll run Y") then stops without making the tool
 * call. The session goes silent — no error, no completion, just nothing.
 *
 * Detection: after each assistant message finalizes, start a watchdog timer.
 * If no tool call or new message arrives within the timeout, the model stalled.
 *
 * Intervention: send a continuation message to the session via the SDK client.
 * The message is a system-reminder-style nudge that pushes the model to
 * execute the action it described.
 *
 * Evidence: Wink (2026) showed 94% recovery rate for stalled agents using
 * asynchronous message injection with corrective guidance.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { track } from "../telemetry.js";

const STALL_TIMEOUT_MS = 45_000;
const MAX_NUDGES_PER_SESSION = 3;

const NUDGE_MESSAGE =
  "You described an action but didn't execute it. " +
  "Your last message ended with an intention (e.g., 'Let me...', 'Now I'll...') " +
  "but no tool call followed. Execute the action now. " +
  "If you're blocked, say so explicitly with a STOP or BLOCKED status.";

interface SessionState {
  watchdog: ReturnType<typeof setTimeout> | null;
  nudgeCount: number;
  lastToolCallTs: number;
  lastMessageTs: number;
}

const sessions = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { watchdog: null, nudgeCount: 0, lastToolCallTs: 0, lastMessageTs: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

function clearWatchdog(state: SessionState): void {
  if (state.watchdog) {
    clearTimeout(state.watchdog);
    state.watchdog = null;
  }
}

const plugin: Plugin = async (input) => {
  const client = input.client;

  function startWatchdog(sessionId: string, state: SessionState): void {
    clearWatchdog(state);

    if (state.nudgeCount >= MAX_NUDGES_PER_SESSION) return;

    state.watchdog = setTimeout(async () => {
      state.watchdog = null;

      // Check if a tool call happened since we set the timer
      if (state.lastToolCallTs > state.lastMessageTs) return;

      state.nudgeCount++;
      track("agent.stall.nudge", {
        ops_count: state.nudgeCount,
      });

      try {
        await client.session.promptAsync({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text: NUDGE_MESSAGE }],
          },
        });
      } catch {
        // Best-effort — if the session is gone or busy, skip silently
      }
    }, STALL_TIMEOUT_MS);
  }

  return {
    "tool.execute.before": async (
      toolInput: { sessionID: string },
    ) => {
      const state = getState(toolInput.sessionID);
      state.lastToolCallTs = Date.now();
      clearWatchdog(state);
    },

    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info as {
          role?: string;
          sessionID?: string;
          time?: { completed?: number | null };
        } | undefined;

        if (!info || info.role !== "assistant") return;
        if (!info.sessionID) return;

        const state = getState(info.sessionID);

        // Message finalized — the model stopped generating
        if (info.time?.completed != null) {
          state.lastMessageTs = Date.now();
          startWatchdog(info.sessionID, state);
        } else {
          // Still streaming — reset the watchdog
          clearWatchdog(state);
        }
      }

      if (event.type === "session.idle") {
        // Session ended — clean up
        for (const [id, state] of sessions) {
          clearWatchdog(state);
        }
        sessions.clear();
      }
    },
  };
};

export default plugin;
