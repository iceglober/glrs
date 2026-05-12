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
  | { kind: "error"; message: string };

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
 */
export async function waitForIdle(
  client: OpencodeClient,
  opts: {
    sessionId: string;
    stallMs?: number;
    abortSignal?: AbortSignal;
  },
): Promise<SessionResult> {
  const stallMs = opts.stallMs ?? 60 * 60 * 1000;

  // Establish the subscription eagerly (before we wait for events)
  const sse = await client.event.subscribe();

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
          const eventSessionId = props["sessionID"] as string | undefined;

          // Only care about our session
          if (eventSessionId !== opts.sessionId) continue;

          resetStall();

          const type = ev.type ?? "";

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
 * Get the cost of a session in USD.
 */
export async function getSessionCost(
  client: OpencodeClient,
  sessionId: string,
): Promise<number> {
  try {
    const result = await client.session.get({ path: { id: sessionId } });
    if (!result.data) return 0;
    const session = result.data as { cost?: number };
    return session.cost ?? 0;
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
