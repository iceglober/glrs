/**
 * stall-detector dead-turn tests — the thinking-spiral recovery path.
 *
 * Regression: a Gemini Flash PRIME session (session-gemini-flash.md,
 * 2026-06-11) ended on a 106s turn of ~100 near-identical thinking paragraphs
 * with NO text part and NO tool call, then sat idle forever. The intent-
 * language watchdog never fires for these (no text to match), so the plugin
 * now inspects the final assistant message at session.idle and pushes a
 * bounded corrective.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import stallDetectorPlugin, { __test__ } from "../src/plugins/stall-detector.js";

const { isDeadTurnParts, deadTurnNudges, DEAD_TURN_NUDGE, MAX_DEAD_TURN_NUDGES } = __test__;

// ---- isDeadTurnParts ---------------------------------------------------------

describe("isDeadTurnParts", () => {
  it("true for reasoning-only turns", () => {
    expect(isDeadTurnParts([{ type: "reasoning", text: "Confirming Data Points…" }])).toBe(true);
    expect(
      isDeadTurnParts([
        { type: "step-start" },
        { type: "reasoning", text: "Validating Source Ticket…" },
        { type: "step-finish" },
      ]),
    ).toBe(true);
  });

  it("false when the turn produced text or a tool call", () => {
    expect(isDeadTurnParts([{ type: "text", text: "Here's my plan." }])).toBe(false);
    expect(isDeadTurnParts([{ type: "reasoning", text: "x" }, { type: "tool" }])).toBe(false);
    expect(
      isDeadTurnParts([{ type: "reasoning", text: "x" }, { type: "text", text: "answer" }]),
    ).toBe(false);
  });

  it("whitespace-only text does not count as output", () => {
    expect(isDeadTurnParts([{ type: "text", text: "  \n " }])).toBe(true);
  });

  it("true for completed EMPTY turns; false when parts are missing entirely", () => {
    // Empty continuation = the model generated nothing after tool results —
    // a real dead turn (exp1-runA: skill load → empty turn → 9s session death).
    expect(isDeadTurnParts([])).toBe(true);
    // Missing parts array = we couldn't read the message shape; don't judge.
    expect(isDeadTurnParts(undefined)).toBe(false);
  });
});

// ---- idle-time nudge flow ------------------------------------------------------

interface FakeMessage {
  info?: { role?: string; error?: unknown; time?: { completed?: number | null } };
  parts?: { type?: string; text?: string }[];
}

function fakeClient(lastMessage: FakeMessage | null) {
  const pushes: { sessionID: string; text: string }[] = [];
  const client = {
    session: {
      messages: async () => ({ data: lastMessage ? [lastMessage] : [] }),
      promptAsync: async (args: { path: { id: string }; body: { parts: { text: string }[] } }) => {
        pushes.push({ sessionID: args.path.id, text: args.body.parts[0]!.text });
        return {};
      },
    },
  };
  return { client, pushes };
}

async function fireIdle(client: unknown, sessionID: string) {
  const hooks = await stallDetectorPlugin({ client } as any);
  await (hooks as any).event({ event: { type: "session.idle", properties: { sessionID } } });
}

const DEAD_TURN: FakeMessage = {
  info: { role: "assistant", time: { completed: Date.now() } },
  parts: [{ type: "reasoning", text: "Confirming Data Points…" }],
};

describe("dead-turn nudge at session.idle", () => {
  beforeEach(() => deadTurnNudges.clear());

  it("nudges a thinking-only turn", async () => {
    const { client, pushes } = fakeClient(DEAD_TURN);
    await fireIdle(client, "ses_dead");
    expect(pushes.length).toBe(1);
    expect(pushes[0]!.sessionID).toBe("ses_dead");
    expect(pushes[0]!.text).toBe(DEAD_TURN_NUDGE);
  });

  it("respects the per-session nudge budget", async () => {
    const { client, pushes } = fakeClient(DEAD_TURN);
    for (let i = 0; i < MAX_DEAD_TURN_NUDGES + 3; i++) {
      await fireIdle(client, "ses_budget");
    }
    expect(pushes.length).toBe(MAX_DEAD_TURN_NUDGES);
  });

  it("skips turns that produced text or tool calls", async () => {
    const withText = fakeClient({
      info: { role: "assistant", time: { completed: Date.now() } },
      parts: [{ type: "text", text: "Done — summary below." }],
    });
    await fireIdle(withText.client, "ses_text");
    expect(withText.pushes.length).toBe(0);

    const withTool = fakeClient({
      info: { role: "assistant", time: { completed: Date.now() } },
      parts: [{ type: "reasoning", text: "x" }, { type: "tool" }],
    });
    await fireIdle(withTool.client, "ses_tool");
    expect(withTool.pushes.length).toBe(0);
  });

  it("skips aborted/errored and incomplete messages (user pressed esc ≠ spiral)", async () => {
    const errored = fakeClient({
      info: { role: "assistant", error: { name: "MessageAbortedError" }, time: { completed: Date.now() } },
      parts: [{ type: "reasoning", text: "x" }],
    });
    await fireIdle(errored.client, "ses_err");
    expect(errored.pushes.length).toBe(0);

    const incomplete = fakeClient({
      info: { role: "assistant", time: { completed: null } },
      parts: [{ type: "reasoning", text: "x" }],
    });
    await fireIdle(incomplete.client, "ses_incomplete");
    expect(incomplete.pushes.length).toBe(0);
  });

  it("skips when the last message is the user's or absent", async () => {
    const userLast = fakeClient({
      info: { role: "user", time: { completed: Date.now() } },
      parts: [{ type: "text", text: "hi" }],
    });
    await fireIdle(userLast.client, "ses_user");
    expect(userLast.pushes.length).toBe(0);

    const empty = fakeClient(null);
    await fireIdle(empty.client, "ses_empty");
    expect(empty.pushes.length).toBe(0);
  });

  it("never throws when the client errors", async () => {
    const client = {
      session: {
        messages: async () => {
          throw new Error("session gone");
        },
        promptAsync: async () => ({}),
      },
    };
    await fireIdle(client, "ses_gone"); // must not reject
  });
});
