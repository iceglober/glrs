/**
 * stall-detector — watchdog timer that nudges stalled agents.
 *
 * The stall pattern: model generates text describing what it'll do next
 * ("Let me check X", "Now I'll run Y") then stops without making the tool
 * call. The session goes silent — no error, no completion, just nothing.
 *
 * Detection: after each assistant message finalizes, start a watchdog timer.
 * If no tool call or new message arrives within the timeout AND the message
 * ends with unfulfilled-intent language, the model stalled.
 *
 * Intervention: send a continuation message to the session via the SDK client.
 * The message is a system-reminder-style nudge that pushes the model to
 * execute the action it described.
 *
 * Evidence: Wink (2026) showed 94% recovery rate for stalled agents using
 * asynchronous message injection with corrective guidance.
 */

import type { Plugin } from "@opencode-ai/plugin";

const STALL_TIMEOUT_MS = 90_000;
const MAX_NUDGES_PER_SESSION = 3;
const SUBAGENT_GRACE_MS = 5 * 60 * 1000;

const NUDGE_MESSAGE =
  "You described an action but didn't execute it. " +
  "Your last message ended with an intention (e.g., 'Let me...', 'Now I'll...') " +
  "but no tool call followed. Execute the action now. " +
  "If you're blocked, say so explicitly with a STOP or BLOCKED status.";

// Messages ending with these patterns are completions, not stalls.
const DONE_PATTERNS = [
  /\bSTATUS:\s*DONE\b/i,
  /\bSTOP\b.*\b(complete|done|no.*action|no.*pending)\b/i,
  /\b(work|task|PR|issue)\b.*\b(complete|done|shipped|merged|open)\b/i,
  /\bno\s+(further|pending|remaining)\s+action\b/i,
];

// Unfulfilled-intent language — the model declared it would take an action.
// Only nudge when the message tail matches one of these; a long analysis
// or summary that happens not to end with a tool call is not a stall.
const INTENT_PATTERNS = [
  /\b(?:let me|i'll|i will)\b(?!\s+know\b).{0,300}$/is,
  /\b(?:now i|going to|about to)\b\s+\w.{0,300}$/is,
];

function looksComplete(text: string): boolean {
  const tail = text.slice(-500);
  return DONE_PATTERNS.some((p) => p.test(tail));
}

function looksLikeUnfulfilledIntent(text: string): boolean {
  const tail = text.slice(-500);
  return INTENT_PATTERNS.some((p) => p.test(tail));
}

interface SessionState {
  watchdog: ReturnType<typeof setTimeout> | null;
  nudgeCount: number;
  lastToolCallTs: number;
  lastMessageTs: number;
  lastMessageText: string;
  activeToolCalls: number;
  lastTaskDispatchTs: number;
}

const sessions = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { watchdog: null, nudgeCount: 0, lastToolCallTs: 0, lastMessageTs: 0, lastMessageText: "", activeToolCalls: 0, lastTaskDispatchTs: 0 };
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
    // Never start the watchdog while tools or subagents are active.
    if (state.activeToolCalls > 0) return;
    if (Date.now() - state.lastTaskDispatchTs < SUBAGENT_GRACE_MS) return;

    state.watchdog = setTimeout(async () => {
      state.watchdog = null;

      // Re-check at fire time — state may have changed since the timer started.
      if (state.lastToolCallTs > state.lastMessageTs) return;
      if (state.activeToolCalls > 0) return;
      if (looksComplete(state.lastMessageText)) return;
      if (Date.now() - state.lastTaskDispatchTs < SUBAGENT_GRACE_MS) return;
      if (!looksLikeUnfulfilledIntent(state.lastMessageText)) return;

      state.nudgeCount++;

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
      toolInput: { sessionID: string; tool?: string },
    ) => {
      const state = getState(toolInput.sessionID);
      state.lastToolCallTs = Date.now();
      state.activeToolCalls++;
      if (toolInput.tool === "task") {
        state.lastTaskDispatchTs = Date.now();
      }
      clearWatchdog(state);
    },

    "tool.execute.after": async (
      toolInput: { sessionID: string },
    ) => {
      const state = getState(toolInput.sessionID);
      state.activeToolCalls = Math.max(0, state.activeToolCalls - 1);
    },

    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info as {
          role?: string;
          sessionID?: string;
          content?: string;
          time?: { completed?: number | null };
        } | undefined;

        if (!info || info.role !== "assistant") return;
        if (!info.sessionID) return;

        const state = getState(info.sessionID);

        // Message finalized — the model stopped generating
        if (info.time?.completed != null) {
          state.lastMessageTs = Date.now();
          state.lastMessageText = typeof info.content === "string" ? info.content : "";
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
