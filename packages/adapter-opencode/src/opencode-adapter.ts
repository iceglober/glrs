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
import * as fs from "node:fs";
import {
  createOpencode,
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
 *
 * Uses createOpencode() which spawns the server process and creates
 * a connected client. The server inherits process.cwd() as its project
 * directory.
 *
 * When `agentOverrides` is provided, sets GLRS_AGENT_OVERRIDES in the
 * server environment before startup, and restores the prior value on
 * shutdown to keep the parent process clean.
 */
export async function startServer(opts: {
  cwd: string;
  port?: number;
  timeoutMs?: number;
  agentOverrides?: Record<string, { model?: string; prompt?: string }>;
}): Promise<StartedServer> {
  await ensureOpencodeOnPath();

  const timeoutMs = opts.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const port = opts.port ?? 0;

  // Save the prior value of GLRS_AGENT_OVERRIDES so we can restore it
  const priorEnvValue = process.env["GLRS_AGENT_OVERRIDES"];
  try {
    // Set the env var if overrides are provided
    if (opts.agentOverrides) {
      process.env["GLRS_AGENT_OVERRIDES"] = JSON.stringify(opts.agentOverrides);
    }

    // createOpencode() starts the server and returns a connected client.
    // The server uses process.cwd() as the project directory.
    const { client, server } = await createOpencode({
      port,
      timeout: timeoutMs,
      hostname: "127.0.0.1",
    });

    let shutdownCalled = false;
    const shutdown = async () => {
      if (shutdownCalled) return;
      shutdownCalled = true;
      try {
        server.close();
      } catch {
        // Ignore shutdown errors
      }
      // Restore the prior env var value to keep the parent process clean
      if (priorEnvValue === undefined) {
        delete process.env["GLRS_AGENT_OVERRIDES"];
      } else {
        process.env["GLRS_AGENT_OVERRIDES"] = priorEnvValue;
      }
    };

    return { url: server.url, client, shutdown };
  } catch (err) {
    // Restore on error during startup
    if (priorEnvValue === undefined) {
      delete process.env["GLRS_AGENT_OVERRIDES"];
    } else {
      process.env["GLRS_AGENT_OVERRIDES"] = priorEnvValue;
    }
    throw err;
  }
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
    onToolCall?: (toolName: string, firstArg?: string) => void;
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
    onToolCall?: (toolName: string, firstArg?: string) => void;
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
  // fire the callback twice if the SDK emits multiple events for the
  // same call (defensive dedup).
  const reportedToolCalls = new Set<string>();

  // Optional synchronous diagnostic log. Opened once here (outside the
  // hot loop) so writes inside the loop are synchronous and never cause
  // event drops. Activated by GLRS_DEBUG_SSE=1 env var.
  let sseFd: number | null = null;
  if (process.env["GLRS_DEBUG_SSE"] === "1") {
    try {
      sseFd = fs.openSync("/tmp/glrs-sse.log", "a");
    } catch {
      // Non-fatal — diagnostic mode is best-effort
    }
  }

  const sseLog = (msg: string) => {
    if (sseFd !== null) {
      try {
        fs.writeSync(sseFd, `${new Date().toISOString()} ${msg}\n`);
      } catch {
        // Non-fatal
      }
    }
  };

  return new Promise<SessionResult>((resolve) => {
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let pollerRunning = true;

    const settle = (result: SessionResult) => {
      if (settled) return;
      settled = true;
      pollerRunning = false;
      if (stallTimer) clearTimeout(stallTimer);
      if (sseFd !== null) {
        try { fs.closeSync(sseFd); } catch { /* non-fatal */ }
      }
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

    // Messages poller — polls session.messages() every 2s for tool call
    // visibility. SSE doesn't deliver message.part.updated events in v1.15,
    // so this is the only way to get real-time tool call data.
    if (opts.onToolCall) {
      (async () => {
        while (pollerRunning && !settled) {
          await new Promise(r => setTimeout(r, 2000));
          if (!pollerRunning || settled) break;
          try {
            const msgs = await client.session.messages({ path: { id: opts.sessionId } });
            const messages = (msgs as any)?.data ?? msgs;
            if (!Array.isArray(messages)) continue;
            for (const msg of messages) {
              if (msg?.info?.role !== "assistant") continue;
              for (const part of msg?.parts ?? []) {
                if (part?.type !== "tool") continue;
                const callID = part.callID ?? part.id ?? "";
                const status = part.state?.status ?? "";
                const key = `${callID}:${status}`;
                if (reportedToolCalls.has(key)) continue;
                if (status !== "running" && status !== "completed" && status !== "error") continue;
                reportedToolCalls.add(key);
                resetStall();

                const input = part.state?.input;
                let firstArg: string | undefined;
                if (input && typeof input === "object") {
                  for (const k of ["filePath", "file_path", "path", "command", "pattern", "query"]) {
                    const val = (input as Record<string, unknown>)[k];
                    if (typeof val === "string" && val.length > 0) {
                      firstArg = val.length > 80 ? val.slice(0, 77) + "..." : val;
                      break;
                    }
                  }
                }
                try {
                  opts.onToolCall!(part.tool ?? "unknown", firstArg);
                } catch { /* non-fatal */ }
              }

              // Also fire cost update from message data
              if (opts.onCostUpdate && msg?.info?.cost > 0) {
                const costKey = `cost:${msg.info.id}`;
                if (!reportedToolCalls.has(costKey)) {
                  reportedToolCalls.add(costKey);
                }
              }
            }

            // Fire cumulative cost update (sum across all assistant messages)
            if (opts.onCostUpdate) {
              let totalCost = 0;
              let totalIn = 0;
              let totalOut = 0;
              for (const m of messages) {
                if (m?.info?.role === "assistant" && typeof m.info.cost === "number") {
                  totalCost += m.info.cost;
                  const t = m.info.tokens ?? {};
                  totalIn += t.input ?? 0;
                  totalOut += t.output ?? 0;
                }
              }
              if (totalCost > 0) {
                const costKey = `cumcost:${totalCost.toFixed(6)}`;
                if (!reportedToolCalls.has(costKey)) {
                  reportedToolCalls.add(costKey);
                  try {
                    opts.onCostUpdate(totalCost, { input: totalIn, output: totalOut });
                  } catch { /* non-fatal */ }
                }
              }
            }
          } catch { /* non-fatal — polling is best-effort */ }
        }
      })();
    }

    // Iterate the event stream
    (async () => {
      try {
        for await (const event of sse.stream) {
          if (settled) break;

          const ev = event as { type?: string; properties?: Record<string, unknown> };
          const props = ev.properties ?? {};
          const type = ev.type ?? "";

          sseLog(`[SSE] type=${type}`);

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

          // Tool-call detection: fires on `message.part.updated` or
          // `message.part.delta` events that carry a tool part.
          //
          // Filter conditions (relaxed from strict "completed"-only):
          //   A. part.type === "tool" AND part.state.status === "completed"
          //      (original condition — fires when tool finishes)
          //   B. part.type === "tool" AND part.state.status === "running"
          //      (fires when tool starts — useful for long-running tools)
          //   C. part.type === "tool" AND part.tool is set AND status is
          //      absent/undefined (some OpenCode versions omit status)
          //
          // Dedup by callID so we never fire the callback twice for the
          // same tool invocation regardless of which condition matched.
          if (opts.onToolCall && (type === "message.part.updated" || type === "message.part.delta")) {
            const part = props["part"] as
              | {
                  type?: string;
                  sessionID?: string;
                  tool?: string;
                  callID?: string;
                  state?: {
                    status?: string;
                    input?: Record<string, unknown>;
                  };
                }
              | undefined;

            if (part && part.type === "tool" && part.sessionID === opts.sessionId) {
              const status = part.state?.status;
              const hasCallId = !!part.callID;
              const hasTool = !!part.tool;

              // Determine if this event should fire the callback
              const shouldFire =
                hasCallId &&
                hasTool &&
                !reportedToolCalls.has(part.callID!) &&
                (
                  status === "completed" ||   // A: tool finished
                  status === "running" ||     // B: tool started
                  status === undefined        // C: status absent
                );

              sseLog(`[TOOL] type=${part.type} status=${status} tool=${part.tool} sessionMatch=${part.sessionID === opts.sessionId} callID=${part.callID} shouldFire=${shouldFire}`);

              if (shouldFire) {
                reportedToolCalls.add(part.callID!);
                resetStall();
                // Extract the first meaningful argument from the tool input.
                // Priority order: filePath, file_path, path, command, pattern, query.
                // First defined string value wins. Truncated to 80 chars.
                let firstArg: string | undefined;
                const input = part.state?.input;
                if (input) {
                  const argKeys = ["filePath", "file_path", "path", "command", "pattern", "query"];
                  for (const key of argKeys) {
                    const val = input[key];
                    if (typeof val === "string" && val.length > 0) {
                      firstArg = val.length > 80 ? val.slice(0, 77) + "..." : val;
                      break;
                    }
                  }
                }
                try {
                  opts.onToolCall(part.tool ?? "unknown", firstArg);
                } catch {
                  // Callback errors don't affect the loop
                }
                continue;
              }
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
            sseLog(`[ERROR] session.error: ${msg} props=${JSON.stringify(props)}`);
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
  const stats = await getSessionStats(client, sessionId);
  return stats.cost;
}

/**
 * Get cumulative cost + token totals for a session.
 *
 * Sums cost, input tokens, and output tokens across all assistant
 * messages. Returns zeros on any error (non-fatal).
 */
export async function getSessionStats(
  client: OpencodeClient,
  sessionId: string,
): Promise<{ cost: number; tokensIn: number; tokensOut: number }> {
  try {
    const result = await client.session.messages({ path: { id: sessionId } });
    if (!result.data) {
      return { cost: 0, tokensIn: 0, tokensOut: 0 };
    }

    type MessageEntry = {
      info: {
        role: string;
        cost?: number;
        tokens?: { input?: number; output?: number };
      };
    };
    const messages = result.data as unknown as MessageEntry[];

    let cost = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    for (const m of messages) {
      if (m.info.role === "assistant") {
        if (typeof m.info.cost === "number") cost += m.info.cost;
        if (m.info.tokens) {
          tokensIn += m.info.tokens.input ?? 0;
          tokensOut += m.info.tokens.output ?? 0;
        }
      }
    }
    return { cost, tokensIn, tokensOut };
  } catch {
    return { cost: 0, tokensIn: 0, tokensOut: 0 };
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
