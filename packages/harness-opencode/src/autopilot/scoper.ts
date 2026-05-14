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
import * as path from "node:path";
import {
  startServer,
  createSession,
  sendAndWait,
  getLastAssistantMessage,
} from "../lib/opencode-server.js";

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

/** ANSI reset + clear line + carriage return. Cleans up any pino color
 *  state that would confuse inquirer's readline cursor tracking. */
const ANSI_RESET = "\x1b[0m\x1b[2K\r";

/** Simple braille-dot spinner for "agent is thinking" feedback. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Spinner {
  start(label?: string): void;
  stop(): void;
}

function createSpinner(): Spinner {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;

  return {
    start(label = "Thinking") {
      if (timer) return;
      frame = 0;
      const isTTY = process.stderr.isTTY ?? false;
      if (!isTTY) return; // no spinner in non-TTY (piped) mode
      timer = setInterval(() => {
        const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
        process.stderr.write(`\x1b[2K\r\x1b[36m${f}\x1b[0m ${label}...`);
        frame++;
      }, 80);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      process.stderr.write("\x1b[2K\r"); // clear the spinner line
    },
  };
}

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
 * Parse a scope summary from an agent response.
 * A valid summary starts with 'SCOPE_SUMMARY:' on the first line,
 * followed by the summary text on subsequent lines.
 * Returns the summary text (without the prefix), or null.
 */
export function parseScopeSummary(response: string): string | null {
  const match = response.match(/^SCOPE_SUMMARY:\s*\n?([\s\S]+)$/);
  return match ? (match[1]?.trim() ?? null) : null;
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
  "You have asked enough questions. Present a SCOPE_SUMMARY for user approval, then write scope.md and emit SCOPE_COMPLETE.";
const PARSE_RETRY_REMINDER =
  "Your last response did not follow the strict contract. " +
  "Respond with EXACTLY one of: (a) a single question (≤200 chars, ending with '?'), " +
  "(b) a scope summary starting with 'SCOPE_SUMMARY:', or " +
  "(c) the sentinel 'SCOPE_COMPLETE: <absolute-path>'. Nothing else.";

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
  const spinner = createSpinner();

  try {
    const sessionId = await _createSession(server.client, {
      cwd: opts.planDir,
      agentName: "scoper",
    });

    // Build the initial prompt embedding the user's goal
    const initialPrompt = [
      "You are running in an inquirer-driven wizard. Follow the strict response contract:",
      "- Every response must be EXACTLY one of:",
      "  (a) A single question (≤200 chars, ending with '?')",
      "  (b) A scope summary starting with 'SCOPE_SUMMARY:' for user approval",
      "  (c) The sentinel 'SCOPE_COMPLETE: <absolute-path>'",
      "- Do NOT call the question tool. Emit questions as plain assistant text.",
      "- Start with first-principles questions (WHAT and WHY), not implementation details.",
      "",
      `The user wants to build: ${opts.initialGoal}`,
      "",
      "Begin by asking your first clarifying question about the problem being solved.",
    ].join("\n");

    // Send the initial prompt
    spinner.start("Scoper is thinking");
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
        spinner.stop();
        // Validate the file exists
        if (!_existsSync(scopePath)) {
          throw new Error(
            `Scoper emitted SCOPE_COMPLETE but scope.md does not exist at: ${scopePath}`,
          );
        }
        return { scopePath };
      }

      // Hard cap check — if we've asked MAX_QUESTIONS and the response
      // isn't a sentinel, force finalize regardless of response type.
      // This must come BEFORE question/summary parsing so that a 9th
      // question or a prose response after the cap both trigger finalize.
      if (questionsAsked >= MAX_QUESTIONS) {
        // Send forced-finalize message
        spinner.start("Finalizing scope");
        const finalResult = await _sendAndWait(server.client, {
          sessionId,
          message: FORCED_FINALIZE_MESSAGE,
          stallMs: timeoutMs,
          autoRejectPermissions: true,
        });

        if (finalResult.kind !== "idle") {
          throw new Error(
            `Scoper session failed during forced finalize: ${finalResult.kind}`,
          );
        }

        // Check for sentinel after forced finalize
        const finalMessage = await _getLastAssistantMessage(
          server.client,
          sessionId,
        );
        const finalScopePath = extractScopeCompletePath(finalMessage);
        if (finalScopePath) {
          spinner.stop();
          if (!_existsSync(finalScopePath)) {
            throw new Error(
              `Scoper emitted SCOPE_COMPLETE after forced finalize but scope.md does not exist at: ${finalScopePath}`,
            );
          }
          return { scopePath: finalScopePath };
        }

        // Sentinel not found — try disk fallback
        const expectedScopePath = path.join(opts.planDir, opts.slug, "scope.md");
        if (_existsSync(expectedScopePath)) {
          spinner.stop();
          process.stderr.write(
            `\n  ⚠ Scoper didn't emit sentinel, but scope.md exists at ${expectedScopePath}. Using it.\n\n`,
          );
          return { scopePath: expectedScopePath };
        }

        // Neither sentinel nor file — self-construct
        spinner.stop();
        process.stderr.write(
          `\n  ⚠ Scoper didn't write scope.md. Constructing from conversation.\n\n`,
        );
        const scopeDir = path.join(opts.planDir, opts.slug);
        if (!_existsSync(scopeDir)) {
          fs.mkdirSync(scopeDir, { recursive: true });
        }
        const constructedScope = [
          `# ${opts.initialGoal}`,
          "",
          "## Goal",
          "",
          opts.initialGoal,
          "",
          "## Scoper conversation summary",
          "",
          "The scoper agent asked 8 questions and the user provided answers,",
          "but the agent did not produce a formal scope.md. The last agent",
          "response is included below for the plan agent to work from.",
          "",
          "### Last agent response",
          "",
          finalMessage || "(no response captured)",
          "",
          "## Acceptance criteria",
          "",
          "- To be determined by the plan agent based on the conversation above.",
          "",
          "## Constraints",
          "",
          "- To be determined by the plan agent.",
          "",
          "## Out of scope",
          "",
          "- To be determined by the plan agent.",
          "",
          "## Open questions for the plan agent",
          "",
          "- The scoper did not complete formally. Review the conversation summary above and fill in the missing sections.",
        ].join("\n");

        const constructedPath = path.join(scopeDir, "scope.md");
        fs.writeFileSync(constructedPath, constructedScope);
        return { scopePath: constructedPath };
      }

      // Try scope summary (approval gate)
      const summary = parseScopeSummary(lastMessage);
      if (summary) {
        spinner.stop();
        parseRetryPending = false;

        // Show the summary and ask for approval
        process.stderr.write(ANSI_RESET);
        process.stderr.write(`\n\x1b[1m📋 Scope summary:\x1b[0m\n\n${summary}\n\n`);
        const approval = await _promptUser("Approve this scope? (yes / or describe what to change)");

        if (approval.toLowerCase().startsWith("yes") || approval.toLowerCase() === "y" || approval.toLowerCase() === "approve") {
          // User approved — tell the agent to write scope.md and emit sentinel
          spinner.start("Writing scope.md");
          const writeResult = await _sendAndWait(server.client, {
            sessionId,
            message: "The user approved the scope. Write scope.md now and emit SCOPE_COMPLETE.",
            stallMs: timeoutMs,
            autoRejectPermissions: true,
          });

          if (writeResult.kind !== "idle") {
            throw new Error(
              `Scoper session failed after scope approval: ${writeResult.kind}`,
            );
          }
          // Loop back to check for the sentinel
          continue;
        } else {
          // User wants changes — send their feedback as the next message
          spinner.start("Scoper is revising");
          const reviseResult = await _sendAndWait(server.client, {
            sessionId,
            message: approval,
            stallMs: timeoutMs,
            autoRejectPermissions: true,
          });

          if (reviseResult.kind !== "idle") {
            throw new Error(
              `Scoper session failed during revision: ${reviseResult.kind}`,
            );
          }
          // Loop back to parse the revised response (could be another summary or a question)
          continue;
        }
      }

      // Try question
      const question = parseQuestion(lastMessage);
      if (question) {
        parseRetryPending = false;

        // Prompt the user via inquirer
        spinner.stop();
        process.stderr.write(ANSI_RESET);
        questionsAsked++;
        const userAnswer = await _promptUser(question);

        // Send the answer back to the session
        spinner.start("Scoper is thinking");
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

      // Parse error — neither a question, summary, nor sentinel
      if (parseRetryPending) {
        spinner.stop();
        // Second consecutive parse failure — throw
        throw new Error(
          `Scoper response did not follow the strict contract after retry. ` +
            `Last response: ${lastMessage.slice(0, 200)}`,
        );
      }

      // First parse failure — send reminder and retry
      parseRetryPending = true;
      spinner.start("Retrying");
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
    spinner.stop();
    await server.shutdown();
  }
}
