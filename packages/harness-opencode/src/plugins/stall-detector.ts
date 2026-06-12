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

// ---- Dead-turn detection ----------------------------------------------------
// A turn that ends with ONLY internal reasoning — no user-visible text, no
// tool call — is a thinking spiral, not a completion. Evidence: a Gemini
// Flash PRIME session (2026-06-11) ended on a 106-second turn of ~100
// near-identical thinking paragraphs ("Confirming Data Points…") with zero
// output, then sat idle forever. The intent-language watchdog above never
// fires for these because there is no message text to match. Detection runs
// at `session.idle` (the turn is over — generation can't be interrupted
// mid-stream) by inspecting the final assistant message's parts.
const DEAD_TURN_NUDGE =
  "Your last turn ended after internal reasoning only — no tool call, no text, no answer. " +
  "You appear to be stuck re-analyzing context you already have. Do NOT re-read, re-fetch, " +
  "or re-confirm anything. In ONE short message: state your conclusion from what you " +
  "already know, then take the single next concrete action (one tool call) or give your " +
  "answer. If something specific is missing, name it in one sentence with a BLOCKED status.";
const MAX_DEAD_TURN_NUDGES = 2;
/** Per-session dead-turn nudge counts. Deliberately NOT cleared on
 * session.idle (unlike the watchdog map) — the budget must survive the very
 * event that triggers the check, or a spiraling model gets nudged forever. */
const deadTurnNudges = new Map<string, number>();

interface MessagePart {
  type?: string;
  text?: string;
}

/** True when an assistant turn's parts contain no user-visible text and no
 * tool call — reasoning/step parts only, or NO parts at all (a completed
 * empty continuation: observed when Gemini Flash loaded a skill, the
 * follow-up turn completed with zero parts, and the session died at 9s).
 * Pure, unit-testable. */
function isDeadTurnParts(parts: MessagePart[] | undefined): boolean {
  if (!Array.isArray(parts)) return false;
  if (parts.length === 0) return true;
  for (const p of parts) {
    if (p?.type === "tool") return false;
    if (p?.type === "text" && typeof p.text === "string" && p.text.trim().length > 0) {
      return false;
    }
  }
  return true;
}

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

  /**
   * Idle-time dead-turn check: fetch the session's final assistant message
   * and nudge if the turn produced reasoning only. One messages() call per
   * idle — same cost class as background-notifier's per-idle job scan.
   * Skips aborted/errored messages (the user pressed esc — that's a choice,
   * not a spiral) and incomplete ones. Fail-silent throughout.
   */
  async function maybeNudgeDeadTurn(sessionID: string): Promise<void> {
    if ((deadTurnNudges.get(sessionID) ?? 0) >= MAX_DEAD_TURN_NUDGES) return;
    try {
      const result = await (client.session as any).messages({
        path: { id: sessionID },
      });
      const messages = result?.data as
        | { info?: { role?: string; error?: unknown; time?: { completed?: number | null } }; parts?: MessagePart[] }[]
        | undefined;
      if (!Array.isArray(messages) || messages.length === 0) return;
      const last = messages[messages.length - 1]!;
      if (last.info?.role !== "assistant") return;
      if (last.info?.error) return;
      if (last.info?.time?.completed == null) return;
      if (!isDeadTurnParts(last.parts)) return;

      // Bound the cross-session map (server processes host many sessions).
      if (deadTurnNudges.size > 500) deadTurnNudges.clear();
      deadTurnNudges.set(sessionID, (deadTurnNudges.get(sessionID) ?? 0) + 1);

      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: DEAD_TURN_NUDGE }] },
      });
    } catch {
      // Session gone, API hiccup — never throw out of the event hook.
    }
  }

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
        // Turn ended — clear watchdog state. (deadTurnNudges deliberately
        // survives this; see its declaration.)
        for (const [, state] of sessions) {
          clearWatchdog(state);
        }
        sessions.clear();

        // Thinking-spiral recovery: a turn that ended with reasoning only
        // (no text, no tool call) gets a bounded corrective push.
        const sessionID: string | undefined = event.properties?.sessionID;
        if (sessionID) await maybeNudgeDeadTurn(sessionID);
      }
    },
  };
};

export default plugin;

// ---- Test exports ---------------------------------------------------------

export const __test__ = {
  isDeadTurnParts,
  deadTurnNudges,
  DEAD_TURN_NUDGE,
  MAX_DEAD_TURN_NUDGES,
};
