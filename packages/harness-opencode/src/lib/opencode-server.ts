/**
 * OpenCode server lifecycle helpers.
 *
 * General-purpose utilities for starting an OpenCode server, creating
 * sessions, sending messages, and waiting for idle. Used by the Ralph
 * autopilot loop and any future feature that needs to drive OpenCode
 * programmatically.
 *
 * Extracted from src/pilot/server.ts so these helpers are not coupled
 * to the pilot subsystem.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createOpencodeServer,
  createOpencodeClient,
} from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";

export const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StartedServer = {
  url: string;
  client: OpencodeClient;
  shutdown: () => Promise<void>;
};

export type SessionResult =
  | { kind: "idle" }
  | { kind: "stall"; stallMs: number }
  | { kind: "abort" }
  | { kind: "error"; message: string }
  | { kind: "question_rejected"; title: string };

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Ensure opencode is on PATH. Throws a user-friendly error if not found.
 */
async function ensureOpencodeOnPath(): Promise<void> {
  try {
    await execFileP("opencode", ["--version"]);
  } catch {
    throw new Error(
      "opencode CLI not found on PATH.\n" +
      "  Install: https://opencode.ai\n" +
      "  Or: bunx opencode upgrade",
    );
  }
}

/**
 * Start an OpenCode server for the given working directory.
 * Returns the server URL, a bound client, and a shutdown function.
 */
export async function startServer(opts: {
  cwd: string;
  port?: number;
  timeoutMs?: number;
}): Promise<StartedServer> {
  await ensureOpencodeOnPath();

  const timeoutMs = opts.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const port = opts.port ?? 0;

  const server = await createOpencodeServer({
    port,
    timeout: timeoutMs,
    hostname: "127.0.0.1",
  });

  const client = createOpencodeClient({ baseUrl: server.url });

  let shutdownCalled = false;
  const shutdown = async () => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    try {
      await server.close();
    } catch {
      // Ignore shutdown errors
    }
  };

  return { url: server.url, client, shutdown };
}

/**
 * Verify the server is responsive by listing sessions.
 * Fails fast with a diagnostic if the server isn't working.
 */
export async function selfTest(client: OpencodeClient): Promise<void> {
  try {
    // Simple health check: list sessions (should return empty or existing)
    await client.session.list();
  } catch (err) {
    throw new Error(
      `OpenCode server self-test failed — the server started but isn't responding to API calls.\n` +
      `  Error: ${err instanceof Error ? err.message : String(err)}\n` +
      `  Run \`opencode --version\` to verify your installation.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Create a new OpenCode session for the given directory.
 *
 * Note: the SDK's `session.create` body takes only `parentID` and `title`
 * — agent selection is a per-message concern in OpenCode's model and lives
 * on `session.prompt`'s body, not on session creation. The working
 * directory is passed via the `query.directory` param.
 *
 * Returns the session ID.
 */
export async function createSession(
  client: OpencodeClient,
  opts: { cwd: string; agentName?: string },
): Promise<string> {
  const result = await client.session.create({
    query: { directory: opts.cwd },
    body: {},
  });
  if (!result.data) {
    throw new Error("session.create returned no data");
  }
  // The `agentName` option is accepted for API compatibility but has no
  // effect at session-creation time. Callers who need it should pass it
  // through `sendAndWait`'s future `agent` option (not yet exposed).
  return result.data.id;
}

/**
 * Send a message to a session and wait for the agent to go idle.
 *
 * Uses `session.prompt` (the correct SDK method for sending a message).
 * `session.chat` does not exist on the SDK — an earlier version of this
 * module used that name and silently failed at runtime.
 *
 * The optional `onToolCall` callback fires once per tool invocation that
 * reaches the `completed` state. Used by the autopilot loop to emit
 * debug-level log events for each tool call.
 *
 * The optional `onTextDelta` callback fires for each assistant text
 * chunk the agent streams. Used by the autopilot loop's stream-liveness
 * indicator — between tool calls, the agent may stream text for minutes
 * while reasoning, and without this signal the user can't distinguish
 * "still working" from "hung."
 *
 * When `autoRejectPermissions: true`, any `permission.updated` event
 * fired for this session is immediately answered with `response: "reject"`.
 * Used by autopilot to prevent the `question` tool (or any tool-approval
 * prompt) from deadlocking the session — no human is available to answer.
 * The `onPermissionRejected` callback (if provided) fires each time a
 * permission is auto-rejected so the caller can log it.
 *
 * Returns the result kind.
 */
export async function sendAndWait(
  client: OpencodeClient,
  opts: {
    sessionId: string;
    message: string;
    agentName?: string;
    stallMs?: number;
    abortSignal?: AbortSignal;
    onToolCall?: (toolName: string) => void;
    onTextDelta?: (charCount: number) => void;
    /** Fires on `message.updated` events with cost/token data. Used for
     *  real-time cost visibility during long iterations. */
    onCostUpdate?: (cost: number, tokens: { input: number; output: number }) => void;
    autoRejectPermissions?: boolean;
    /** Server URL for raw HTTP calls (question-reject endpoint). */
    serverUrl?: string;
    onPermissionRejected?: (permission: {
      id: string;
      type: string;
      title: string;
    }) => void;
  },
): Promise<SessionResult> {
  const stallMs = opts.stallMs ?? 60 * 60 * 1000; // 60 min default

  // Start waiting for idle BEFORE sending the message so we don't miss
  // fast events. The subscription is established; the message send will
  // produce events on it.
  const idlePromise = waitForIdle(client, {
    sessionId: opts.sessionId,
    stallMs,
    abortSignal: opts.abortSignal,
    onToolCall: opts.onToolCall,
    onTextDelta: opts.onTextDelta,
    onCostUpdate: opts.onCostUpdate,
    autoRejectPermissions: opts.autoRejectPermissions,
    serverUrl: opts.serverUrl,
    onPermissionRejected: opts.onPermissionRejected,
  });

  // Send the message via the correct SDK method
  await client.session.prompt({
    path: { id: opts.sessionId },
    body: {
      parts: [{ type: "text", text: opts.message }],
      ...(opts.agentName ? { agent: opts.agentName } : {}),
    },
  });

  return idlePromise;
}

/**
 * Wait for a session to go idle (agent done), stall, abort, or error.
 *
 * `client.event.subscribe()` is async and returns `{ stream }` (a
 * `ServerSentEventsResult`). The stream is an AsyncGenerator of events.
 *
 * When `onToolCall` is provided, fires once per tool invocation that
 * reaches the `completed` state. Filters out pending/running transitions
 * to avoid double-counting.
 *
 * When `onTextDelta` is provided, fires for each non-empty delta string
 * the server emits (charCount = delta.length). Used by autopilot to
 * signal liveness during long reasoning streams between tool calls.
 *
 * When `autoRejectPermissions: true`, any `permission.updated` event
 * for this session is answered with `response: "reject"` via
 * `POST /session/{id}/permissions/{permissionID}`. This prevents the
 * `question` tool (and any tool-approval prompts) from deadlocking the
 * session when no human is present to answer. `onPermissionRejected`
 * fires synchronously with the permission payload so callers can log.
 */
export async function waitForIdle(
  client: OpencodeClient,
  opts: {
    sessionId: string;
    stallMs?: number;
    abortSignal?: AbortSignal;
    onToolCall?: (toolName: string) => void;
    onTextDelta?: (charCount: number) => void;
    /** Fires on `message.updated` events with cost/token data. Used for
     *  real-time cost visibility during long iterations. */
    onCostUpdate?: (cost: number, tokens: { input: number; output: number }) => void;
    autoRejectPermissions?: boolean;
    /** Server URL for raw HTTP calls (question-reject endpoint). */
    serverUrl?: string;
    onPermissionRejected?: (permission: {
      id: string;
      type: string;
      title: string;
    }) => void;
  },
): Promise<SessionResult> {
  const stallMs = opts.stallMs ?? 60 * 60 * 1000;

  // Establish the subscription eagerly (before we wait for events)
  const sse = await client.event.subscribe();

  // Track tool calls we've already reported (by callID) so we don't
  // fire the callback twice if the SDK emits multiple "completed" events
  // for the same call (defensive).
  const reportedToolCalls = new Set<string>();

  return new Promise<SessionResult>((resolve) => {
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (result: SessionResult) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      resolve(result);
    };

    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => settle({ kind: "stall", stallMs }), stallMs);
    };

    // Abort signal
    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        settle({ kind: "abort" });
        return;
      }
      opts.abortSignal.addEventListener("abort", () => settle({ kind: "abort" }), { once: true });
    }

    // Start stall timer
    resetStall();

    // Iterate the event stream
    (async () => {
      try {
        for await (const event of sse.stream) {
          if (settled) break;

          const ev = event as { type?: string; properties?: Record<string, unknown> };
          const props = ev.properties ?? {};
          const type = ev.type ?? "";

          // Real-time cost update: `message.updated` carries the full
          // AssistantMessage with cost + tokens. Fires when a message's
          // metadata updates (including after LLM response completes).
          // This gives us cost visibility DURING long iterations, not
          // just between them.
          if (opts.onCostUpdate && type === "message.updated") {
            const info = props["info"] as
              | { role?: string; cost?: number; tokens?: { input?: number; output?: number } }
              | undefined;
            if (info && info.role === "assistant" && typeof info.cost === "number") {
              resetStall();
              try {
                opts.onCostUpdate(
                  info.cost,
                  {
                    input: info.tokens?.input ?? 0,
                    output: info.tokens?.output ?? 0,
                  },
                );
              } catch {
                // Callback errors don't affect the loop
              }
            }
          }

          // Text-delta detection: both `message.part.delta` (bare delta
          // events) and `message.part.updated` with a non-empty `delta`
          // field carry streamed assistant text. Observed both shapes
          // in the wild; handle both.
          if (opts.onTextDelta && (type === "message.part.delta" || type === "message.part.updated")) {
            const delta = props["delta"];
            if (typeof delta === "string" && delta.length > 0) {
              resetStall();
              try {
                opts.onTextDelta(delta.length);
              } catch {
                // Callback errors don't affect the loop
              }
              // Fall through to also consider tool-call detection below,
              // since `message.part.updated` can carry BOTH a tool part
              // transition AND a delta on the same event.
            }
          }

          // Tool-call detection: message.part.updated with a tool part
          // that transitioned to `completed`. Fires the callback exactly
          // once per call (dedup'd by callID).
          if (opts.onToolCall && type === "message.part.updated") {
            const part = props["part"] as
              | {
                  type?: string;
                  sessionID?: string;
                  tool?: string;
                  callID?: string;
                  state?: { status?: string };
                }
              | undefined;
            if (
              part &&
              part.type === "tool" &&
              part.sessionID === opts.sessionId &&
              part.state?.status === "completed" &&
              part.callID &&
              !reportedToolCalls.has(part.callID)
            ) {
              reportedToolCalls.add(part.callID);
              resetStall();
              try {
                opts.onToolCall(part.tool ?? "unknown");
              } catch {
                // Callback errors don't affect the loop
              }
              continue;
            }
          }

          const eventSessionId = props["sessionID"] as string | undefined;

          // Auto-reject blocking prompts (autopilot mode). Handled
          // BEFORE the session-ID guard because `question.asked` events
          // may not carry a sessionID in their properties (the event
          // type isn't in the SDK's typed event union; its payload
          // shape isn't documented). If the event is for another
          // session, abort is still safe — our session won't be
          // affected — but log it so we can see it happened.
          if (
            opts.autoRejectPermissions &&
            (type === "permission.updated" || type === "question.asked")
          ) {
            const permissionId = props["id"] as string | undefined;
            const permissionType = type === "question.asked" ? "question" : ((props["type"] as string) ?? "unknown");
            const permissionTitle = (props["title"] as string) ?? "";

            if (opts.onPermissionRejected) {
              try {
                opts.onPermissionRejected({
                  id: permissionId ?? "unknown",
                  type: permissionType,
                  title: permissionTitle,
                });
              } catch {
                // Callback errors don't affect the loop
              }
            }

            if (type === "permission.updated" && permissionId) {
              // Fire-and-forget reject via SDK
              (async () => {
                try {
                  await (
                    client as unknown as {
                      postSessionIdPermissionsPermissionId: (opts: {
                        path: { id: string; permissionID: string };
                        body: { response: "once" | "always" | "reject" };
                      }) => Promise<unknown>;
                    }
                  ).postSessionIdPermissionsPermissionId({
                    path: { id: opts.sessionId, permissionID: permissionId },
                    body: { response: "reject" },
                  });
                } catch {
                  // Best effort
                }
              })();
              continue;
            }

            if (type === "question.asked") {
              // Use the v2 question-reject endpoint: POST /question/{requestID}/reject
              // The v1 SDK doesn't have a typed method for this, so we make
              // a raw HTTP call using the server URL.
              if (opts.serverUrl && permissionId) {
                (async () => {
                  try {
                    await fetch(`${opts.serverUrl}/question/${permissionId}/reject`, {
                      method: "POST",
                    });
                  } catch {
                    // Best effort — if reject fails, the session will stall
                    // and the stall timeout will catch it.
                  }
                })();
              }
              // Settle with question_rejected so the loop can retry
              // with a "no questions" reminder instead of dying.
              settle({
                kind: "question_rejected",
                title: permissionTitle,
              });
              break;
            }
          }

          // Only care about our session for session-level events
          if (eventSessionId !== opts.sessionId) continue;

          resetStall();

          if (type === "session.idle") {
            settle({ kind: "idle" });
            break;
          }

          if (type === "session.error") {
            const msg = (props["message"] as string) ?? "session error";
            settle({ kind: "error", message: msg });
            break;
          }
        }
      } catch (err) {
        if (!settled) {
          settle({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
  });
}

/**
 * Get the cumulative cost of a session in USD.
 *
 * Cost is tracked per-message on the server (AssistantMessage.cost),
 * not aggregated on the Session object. We sum across all assistant
 * messages to get a session total.
 */
export async function getSessionCost(
  client: OpencodeClient,
  sessionId: string,
): Promise<number> {
  try {
    const result = await client.session.messages({ path: { id: sessionId } });
    if (!result.data) return 0;

    type MessageEntry = {
      info: { role: string; cost?: number };
    };
    const messages = result.data as unknown as MessageEntry[];

    let total = 0;
    for (const m of messages) {
      if (m.info.role === "assistant" && typeof m.info.cost === "number") {
        total += m.info.cost;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Fetch the last assistant message text from a session.
 *
 * Calls `client.session.messages()`, filters to assistant-role messages,
 * takes the last one, and concatenates all text parts.
 *
 * Returns an empty string if there are no assistant messages or if the
 * API call fails.
 */
export async function getLastAssistantMessage(
  client: OpencodeClient,
  sessionId: string,
): Promise<string> {
  try {
    const result = await client.session.messages({ path: { id: sessionId } });
    if (!result.data) return "";

    type MessageEntry = {
      info: { role: string };
      parts: Array<{ type: string; text?: string }>;
    };
    const messages = result.data as unknown as MessageEntry[];

    // Find the last assistant message
    const assistantMessages = messages.filter((m) => m.info.role === "assistant");
    if (assistantMessages.length === 0) return "";

    const last = assistantMessages[assistantMessages.length - 1];
    if (!last) return "";

    // Concatenate all text parts
    return last.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
  } catch {
    return "";
  }
}
