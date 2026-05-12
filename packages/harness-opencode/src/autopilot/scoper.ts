/**
 * Scoper session runner for the interactive autopilot orchestrator.
 *
 * Runs an opencode session with the @scoper agent, watches for the
 * `SCOPE_COMPLETE: <path>` sentinel in the last assistant message,
 * and returns the scope.md path.
 */

import {
  startServer,
  createSession,
  sendAndWait,
  getLastAssistantMessage,
} from "../lib/opencode-server.js";

/**
 * Extract the scope.md path from the SCOPE_COMPLETE sentinel line.
 * Returns the path string, or null if no sentinel is found.
 *
 * Uses the LAST occurrence if multiple sentinel lines appear (the
 * agent may emit intermediate progress lines before the final one).
 */
export function extractScopeCompletePath(output: string): string | null {
  const lines = output.split("\n");
  let lastMatch: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SCOPE_COMPLETE:")) {
      const rest = trimmed.slice("SCOPE_COMPLETE:".length).trim();
      if (rest.length > 0) {
        lastMatch = rest;
      }
    }
  }

  return lastMatch;
}

export interface ScoperSessionOptions {
  /** Directory where scope.md will be written. */
  planDir: string;
  /** Slug for the plan (used to name the subdirectory). */
  slug: string;
  /** Timeout in milliseconds (default: 15 minutes). */
  timeoutMs?: number;
  /**
   * Injectable server dependencies for testing.
   * When provided, these replace the real server functions.
   * @internal
   */
  _deps?: {
    startServer?: typeof import("../lib/opencode-server.js").startServer;
    createSession?: typeof import("../lib/opencode-server.js").createSession;
    sendAndWait?: typeof import("../lib/opencode-server.js").sendAndWait;
    getLastAssistantMessage?: typeof import("../lib/opencode-server.js").getLastAssistantMessage;
  };
}

export interface ScoperSessionResult {
  scopePath: string;
}

const DEFAULT_SCOPER_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Run an interactive @scoper session.
 *
 * Starts an opencode server, creates a session with the @scoper agent,
 * sends the initial prompt, and waits for the session to go idle.
 * When idle, checks the last assistant message for the SCOPE_COMPLETE
 * sentinel and returns the scope path.
 *
 * The @scoper agent is interactive — it uses the question tool to ask
 * the user questions. autoRejectPermissions is set to false so those
 * questions reach the user.
 */
export async function runScoperSession(
  opts: ScoperSessionOptions,
): Promise<ScoperSessionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SCOPER_TIMEOUT_MS;

  // Resolve server functions — use injected deps in tests, real impls in prod
  const _startServer = opts._deps?.startServer ?? startServer;
  const _createSession = opts._deps?.createSession ?? createSession;
  const _sendAndWait = opts._deps?.sendAndWait ?? sendAndWait;
  const _getLastAssistantMessage =
    opts._deps?.getLastAssistantMessage ?? getLastAssistantMessage;

  const server = await _startServer({ cwd: opts.planDir });

  try {
    const sessionId = await _createSession(server.client, {
      cwd: opts.planDir,
      agentName: "scoper",
    });

    // The @scoper agent is interactive — it uses the question tool to
    // align with the user before writing scope.md. Do NOT auto-reject
    // permissions; the question tool must reach the user.
    const result = await _sendAndWait(server.client, {
      sessionId,
      message:
        "Help me scope a new feature. What are you building?",
      agentName: "scoper",
      stallMs: timeoutMs,
      autoRejectPermissions: false,
    });

    if (result.kind === "abort") {
      throw new Error(
        `Scoper session aborted (timeout after ${timeoutMs}ms).`,
      );
    }

    if (result.kind === "stall") {
      throw new Error(
        `Scoper session stalled for ${result.stallMs}ms with no idle signal.`,
      );
    }

    if (result.kind === "error") {
      throw new Error(`Scoper session error: ${result.message}`);
    }

    // result.kind === "idle" — check for the SCOPE_COMPLETE sentinel
    const lastMessage = await _getLastAssistantMessage(
      server.client,
      sessionId,
    );
    const scopePath = extractScopeCompletePath(lastMessage);

    if (!scopePath) {
      throw new Error(
        "Scoper session completed but did not emit SCOPE_COMPLETE sentinel. " +
          "The @scoper agent may not have finished writing scope.md.",
      );
    }

    return { scopePath };
  } finally {
    await server.shutdown();
  }
}
