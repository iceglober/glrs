/**
 * Scoper session runner — inquirer-driven wizard loop.
 *
 * Starts an opencode server + creates a persistent @scoper session.
 * Sends the user's initial goal as the first prompt, then drives a
 * wizard loop:
 *
 *   1. Wait for the agent's response (idle).
 *   2. Parse the response:
 *      - Question (≤200 chars, ends with '?') → prompt the user via
 *        inquirer, send the answer back, repeat.
 *      - SCOPE_COMPLETE sentinel → validate scope.md exists, return path.
 *      - Parse error → retry once with a reminder; second failure throws.
 *   3. Hard cap: after 8 user answers, send a forced-finalize message.
 *      If the agent still doesn't emit the sentinel, throw.
 *
 * autoRejectPermissions: true — the question tool is disabled at the
 * agent level, but we defend in depth.
 */

import * as fs from "node:fs";
import {
  startServer,
  createSession,
  sendAndWait,
  getLastAssistantMessage,
} from "../lib/opencode-server.js";

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse a question from an agent response.
 * A valid question is a single line, ≤200 chars, ending with '?'.
 * Returns the question string, or null if the response is not a question.
 */
export function parseQuestion(response: string): string | null {
  const match = response.match(/^([^\n]{1,199}\?)\s*$/);
  return match ? (match[1] ?? null) : null;
}

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

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ScoperSessionOptions {
  /** Directory where scope.md will be written. */
  planDir: string;
  /** Slug for the plan (used to name the subdirectory). */
  slug: string;
  /** The user's initial goal text (embedded in the first prompt). */
  initialGoal: string;
  /** Timeout in milliseconds per turn (default: 5 minutes). */
  timeoutMs?: number;
  /**
   * Injectable dependencies for testing.
   * When provided, these replace the real server functions and inquirer.
   * @internal
   */
  _deps?: {
    startServer?: typeof import("../lib/opencode-server.js").startServer;
    createSession?: typeof import("../lib/opencode-server.js").createSession;
    sendAndWait?: typeof import("../lib/opencode-server.js").sendAndWait;
    getLastAssistantMessage?: typeof import("../lib/opencode-server.js").getLastAssistantMessage;
    /** Mock for inquirer input() — receives the question text, returns the user's answer. */
    promptUser?: (question: string) => Promise<string>;
    /** Mock for fs.existsSync */
    existsSync?: (p: string) => boolean;
  };
}

export interface ScoperSessionResult {
  scopePath: string;
}

const DEFAULT_SCOPER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per turn
const MAX_QUESTIONS = 8;
const FORCED_FINALIZE_MESSAGE =
  "You have asked enough questions. Write scope.md now and emit SCOPE_COMPLETE.";
const PARSE_RETRY_REMINDER =
  "Your last response did not follow the strict contract. " +
  "Respond with EXACTLY a single question (≤200 chars, ending with '?') " +
  "OR the sentinel 'SCOPE_COMPLETE: <absolute-path>'. Nothing else.";

// ---------------------------------------------------------------------------
// Wizard loop
// ---------------------------------------------------------------------------

/**
 * Run the @scoper wizard loop.
 *
 * Starts an opencode server, creates a persistent session with @scoper,
 * sends the initial goal prompt, then drives the wizard loop until the
 * agent emits SCOPE_COMPLETE or the hard cap is reached.
 */
export async function runScoperSession(
  opts: ScoperSessionOptions,
): Promise<ScoperSessionResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SCOPER_TIMEOUT_MS;

  // Resolve injectable deps
  const _startServer = opts._deps?.startServer ?? startServer;
  const _createSession = opts._deps?.createSession ?? createSession;
  const _sendAndWait = opts._deps?.sendAndWait ?? sendAndWait;
  const _getLastAssistantMessage =
    opts._deps?.getLastAssistantMessage ?? getLastAssistantMessage;
  const _existsSync = opts._deps?.existsSync ?? fs.existsSync;

  const _promptUser: (question: string) => Promise<string> =
    opts._deps?.promptUser ??
    (async (question: string) => {
      const { input } = await import("@inquirer/prompts");
      return input({ message: question });
    });

  const server = await _startServer({ cwd: opts.planDir });

  try {
    const sessionId = await _createSession(server.client, {
      cwd: opts.planDir,
      agentName: "scoper",
    });

    // Build the initial prompt embedding the user's goal
    const initialPrompt = [
      "You are running in an inquirer-driven wizard. Follow the strict response contract:",
      "- Every response must be EXACTLY a single question (≤200 chars, ending with '?') OR the sentinel 'SCOPE_COMPLETE: <absolute-path>'.",
      "- Do NOT call the question tool. Emit questions as plain assistant text.",
      "",
      `The user wants to build: ${opts.initialGoal}`,
      "",
      "Begin by asking your first clarifying question.",
    ].join("\n");

    // Send the initial prompt
    const firstResult = await _sendAndWait(server.client, {
      sessionId,
      message: initialPrompt,
      agentName: "scoper",
      stallMs: timeoutMs,
      autoRejectPermissions: true,
    });

    if (firstResult.kind === "abort") {
      throw new Error(`Scoper session aborted (timeout after ${timeoutMs}ms).`);
    }
    if (firstResult.kind === "stall") {
      throw new Error(
        `Scoper session stalled for ${firstResult.stallMs}ms with no idle signal.`,
      );
    }
    if (firstResult.kind === "error") {
      throw new Error(`Scoper session error: ${firstResult.message}`);
    }

    // Wizard loop
    let questionsAsked = 0;
    let parseRetryPending = false;

    while (true) {
      const lastMessage = await _getLastAssistantMessage(
        server.client,
        sessionId,
      );

      // Try sentinel first
      const scopePath = extractScopeCompletePath(lastMessage);
      if (scopePath) {
        // Validate the file exists
        if (!_existsSync(scopePath)) {
          throw new Error(
            `Scoper emitted SCOPE_COMPLETE but scope.md does not exist at: ${scopePath}`,
          );
        }
        return { scopePath };
      }

      // Try question
      const question = parseQuestion(lastMessage);
      if (question) {
        parseRetryPending = false;

        if (questionsAsked >= MAX_QUESTIONS) {
          // Hard cap reached — send forced-finalize
          const finalResult = await _sendAndWait(server.client, {
            sessionId,
            message: FORCED_FINALIZE_MESSAGE,
            stallMs: timeoutMs,
            autoRejectPermissions: true,
          });

          if (finalResult.kind === "abort") {
            throw new Error(
              `Scoper session aborted during forced finalize (timeout after ${timeoutMs}ms).`,
            );
          }
          if (finalResult.kind === "stall") {
            throw new Error(
              `Scoper session stalled during forced finalize for ${finalResult.stallMs}ms.`,
            );
          }
          if (finalResult.kind === "error") {
            throw new Error(
              `Scoper session error during forced finalize: ${finalResult.message}`,
            );
          }

          // Check for sentinel after forced finalize
          const finalMessage = await _getLastAssistantMessage(
            server.client,
            sessionId,
          );
          const finalScopePath = extractScopeCompletePath(finalMessage);
          if (!finalScopePath) {
            throw new Error(
              "Scoper did not emit SCOPE_COMPLETE after forced finalize. " +
                "The @scoper agent failed to comply with the hard cap.",
            );
          }
          if (!_existsSync(finalScopePath)) {
            throw new Error(
              `Scoper emitted SCOPE_COMPLETE after forced finalize but scope.md does not exist at: ${finalScopePath}`,
            );
          }
          return { scopePath: finalScopePath };
        }

        // Prompt the user via inquirer
        questionsAsked++;
        const userAnswer = await _promptUser(question);

        // Send the answer back to the session
        const nextResult = await _sendAndWait(server.client, {
          sessionId,
          message: userAnswer,
          stallMs: timeoutMs,
          autoRejectPermissions: true,
        });

        if (nextResult.kind === "abort") {
          throw new Error(
            `Scoper session aborted (timeout after ${timeoutMs}ms).`,
          );
        }
        if (nextResult.kind === "stall") {
          throw new Error(
            `Scoper session stalled for ${nextResult.stallMs}ms with no idle signal.`,
          );
        }
        if (nextResult.kind === "error") {
          throw new Error(`Scoper session error: ${nextResult.message}`);
        }

        // Loop back to parse the next response
        continue;
      }

      // Parse error — neither a question nor a sentinel
      if (parseRetryPending) {
        // Second consecutive parse failure — throw
        throw new Error(
          `Scoper response did not follow the strict contract after retry. ` +
            `Last response: ${lastMessage.slice(0, 200)}`,
        );
      }

      // First parse failure — send reminder and retry
      parseRetryPending = true;
      const retryResult = await _sendAndWait(server.client, {
        sessionId,
        message: PARSE_RETRY_REMINDER,
        stallMs: timeoutMs,
        autoRejectPermissions: true,
      });

      if (retryResult.kind === "abort") {
        throw new Error(
          `Scoper session aborted during parse retry (timeout after ${timeoutMs}ms).`,
        );
      }
      if (retryResult.kind === "stall") {
        throw new Error(
          `Scoper session stalled during parse retry for ${retryResult.stallMs}ms.`,
        );
      }
      if (retryResult.kind === "error") {
        throw new Error(
          `Scoper session error during parse retry: ${retryResult.message}`,
        );
      }
      // Loop back to parse the retry response
    }
  } finally {
    await server.shutdown();
  }
}
