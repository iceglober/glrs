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

  const server = await (createOpencodeServer as unknown as (opts: { port: number; timeout: number }) => Promise<{ url: string; close: () => Promise<void> }>)({
    port,
    timeout: timeoutMs,
  });

  const client = (createOpencodeClient as unknown as (opts: { url: string }) => OpencodeClient)({ url: server.url });

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
    await (client.session as unknown as { list: () => Promise<unknown> }).list();
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
 * Create a new OpenCode session for the given directory and agent.
 * Returns the session ID.
 */
export async function createSession(
  client: OpencodeClient,
  opts: { cwd: string; agentName?: string },
): Promise<string> {
  const session = await (client.session.create as unknown as (opts: { body: Record<string, unknown> }) => Promise<{ id: string }>)({
    body: {
      directory: opts.cwd,
      ...(opts.agentName ? { agentID: opts.agentName } : {}),
    },
  });
  return session.id;
}

/**
 * Send a message to a session and wait for the agent to go idle.
 * Returns the result kind.
 */
export async function sendAndWait(
  client: OpencodeClient,
  opts: {
    sessionId: string;
    message: string;
    stallMs?: number;
    abortSignal?: AbortSignal;
  },
): Promise<SessionResult> {
  const stallMs = opts.stallMs ?? 60 * 60 * 1000; // 60 min default

  // Send the message
  await (client as unknown as { session: { chat: (opts: { sessionID: string; body: Record<string, unknown> }) => Promise<void> } }).session.chat({
    sessionID: opts.sessionId,
    body: { content: [{ type: "text", text: opts.message }] },
  });

  // Wait for idle
  return waitForIdle(client, {
    sessionId: opts.sessionId,
    stallMs,
    abortSignal: opts.abortSignal,
  });
}

/**
 * Wait for a session to go idle (agent done), stall, abort, or error.
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

  return new Promise<SessionResult>((resolve) => {
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const settle = (result: SessionResult) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      if (unsubscribe) unsubscribe();
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

    // Subscribe to events
    const stream = (client.event.subscribe as unknown as () => AsyncIterable<{ type: string; properties: Record<string, unknown> }>)();
    let streamDone = false;

    (async () => {
      try {
        for await (const event of stream) {
          if (settled) break;

          const props = (event as { properties?: Record<string, unknown> }).properties ?? {};
          const eventSessionId = props["sessionID"] as string | undefined;

          // Only care about our session
          if (eventSessionId !== opts.sessionId) continue;

          resetStall();

          const type = (event as { type?: string }).type ?? "";

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
      } finally {
        streamDone = true;
      }
    })();

    unsubscribe = () => {
      // The stream will be garbage collected; we just stop caring about it
    };
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
    const session = await (client.session.get as unknown as (opts: { sessionID: string }) => Promise<{ cost?: number }>)({ sessionID: sessionId });
    return (session as { cost?: number }).cost ?? 0;
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
    type MessageEntry = {
      info: { role: string };
      parts: Array<{ type: string; text?: string }>;
    };
    const messages = await (
      client.session.messages as unknown as (opts: {
        path: { id: string };
      }) => Promise<MessageEntry[]>
    )({ path: { id: sessionId } });

    // Find the last assistant message
    const assistantMessages = messages.filter((m) => m.info.role === "assistant");
    if (assistantMessages.length === 0) return "";

    const last = assistantMessages[assistantMessages.length - 1];

    // Concatenate all text parts
    return last.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
  } catch {
    return "";
  }
}
