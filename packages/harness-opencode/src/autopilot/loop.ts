/**
 * Ralph loop engine for the autopilot CLI driver.
 *
 * Sends the user's prompt to PRIME each iteration, waits for idle,
 * inspects the response for the `<autopilot-done>` sentinel, and either
 * exits (sentinel found) or re-sends the same prompt (no sentinel).
 *
 * The loop respects:
 *   - max-iterations budget
 *   - total timeout budget
 *   - per-iteration stall timeout (inherited from sendAndWait)
 *   - struggle detection (consecutive zero-progress iterations)
 *   - kill-switch file at `.agent/autopilot-disable`
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  startServer,
  createSession,
  sendAndWait,
  getLastAssistantMessage,
} from "../lib/opencode-server.js";
import { createAutopilotLogger, childLogger } from "../lib/logger.js";
import { detectSentinel } from "./sentinel.js";
import { StruggleDetector, checkKillSwitch } from "./struggle.js";
import {
  MAX_ITERATIONS,
  STRUGGLE_THRESHOLD,
  TIMEOUT_MS,
  STALL_MS,
} from "./config.js";

const execFile = promisify(execFileCb);

export type LoopExitReason =
  | "sentinel"
  | "max-iterations"
  | "timeout"
  | "struggle"
  | "kill-switch"
  | "stall"
  | "error";

export interface LoopResult {
  exitReason: LoopExitReason;
  iterations: number;
  message: string;
}

export interface RalphLoopOptions {
  /** The prompt to send to PRIME each iteration. */
  prompt: string;
  /** Working directory for the OpenCode server. */
  cwd: string;
  /** Maximum number of iterations (default: MAX_ITERATIONS). */
  maxIterations?: number;
  /** Total wall-clock timeout in ms (default: TIMEOUT_MS). */
  timeoutMs?: number;
  /** Per-iteration stall timeout in ms (default: STALL_MS). */
  stallMs?: number;
  /** Struggle threshold — consecutive zero-progress iterations (default: STRUGGLE_THRESHOLD). */
  struggleThreshold?: number;
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

/**
 * Read the autopilot prompt template and prepend it to the user's prompt.
 * The template is co-located with this loop at autopilot/prompt-template.md
 * (both in src/ for dev and dist/ for the built package).
 */
function buildFullPrompt(userPrompt: string): string {
  // Locate prompt-template.md relative to this file's location.
  // In dist/, this file is at dist/autopilot/loop.js and the template is
  // at dist/autopilot/prompt-template.md.
  // In src/ (tests), this file is at src/autopilot/loop.ts and the template
  // is at src/autopilot/prompt-template.md.
  const candidates = [
    join(import.meta.dir, "prompt-template.md"),
    join(import.meta.dir, "..", "..", "src", "autopilot", "prompt-template.md"),
  ];

  let template = "";
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      // Strip YAML frontmatter
      template = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      break;
    } catch {
      // try next candidate
    }
  }

  // Substitute $ARGUMENTS with the user's prompt
  const withArgs = template.replace("$ARGUMENTS", userPrompt);
  return withArgs || userPrompt;
}

/**
 * Check whether the agent made any filesystem progress during an iteration
 * by running `git diff --stat` against the pre-iteration HEAD.
 */
async function checkProgress(cwd: string, baseRef: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("git", ["diff", "--stat", baseRef], { cwd });
    return stdout.trim().length > 0;
  } catch {
    // If git fails, assume progress (don't false-positive on struggle)
    return true;
  }
}

/**
 * Get the current git HEAD SHA for progress tracking.
 */
async function getHeadSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return "HEAD";
  }
}

/**
 * Run the Ralph loop: send prompt → wait for idle → inspect response →
 * retry or exit.
 */
export async function runRalphLoop(opts: RalphLoopOptions): Promise<LoopResult> {
  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const stallMs = opts.stallMs ?? STALL_MS;
  const struggleThreshold = opts.struggleThreshold ?? STRUGGLE_THRESHOLD;

  // Resolve server functions — use injected deps in tests, real impls in prod
  const _startServer = opts._deps?.startServer ?? startServer;
  const _createSession = opts._deps?.createSession ?? createSession;
  const _sendAndWait = opts._deps?.sendAndWait ?? sendAndWait;
  const _getLastAssistantMessage = opts._deps?.getLastAssistantMessage ?? getLastAssistantMessage;

  const fullPrompt = buildFullPrompt(opts.prompt);
  const struggle = new StruggleDetector(struggleThreshold);
  const startTime = Date.now();

  // Create the per-run logger. Two sinks: stderr (user-visible) and
  // a per-run log file (captures everything at trace level).
  const autopilotLog = createAutopilotLogger({ cwd: opts.cwd });
  const log = childLogger(autopilotLog.root, "autopilot.loop");
  const toolLog = childLogger(autopilotLog.root, "autopilot.tool");

  if (autopilotLog.logFilePath) {
    log.info({ file: autopilotLog.logFilePath }, `Logging to ${autopilotLog.logFilePath}`);
  }

  // Start the OpenCode server
  log.info({ cwd: opts.cwd, maxIterations, timeoutMs }, "Starting OpenCode server");
  const server = await _startServer({ cwd: opts.cwd });
  log.info({ url: server.url }, "Server ready");
  const abort = new AbortController();

  // Set up total timeout
  const timeoutHandle = setTimeout(() => {
    abort.abort();
  }, timeoutMs);

  try {
    // Create a session with PRIME
    const sessionId = await _createSession(server.client, {
      cwd: opts.cwd,
      agentName: "prime",
    });
    log.info({ sessionId }, "Session created with PRIME");

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      // Check kill switch before each iteration
      if (checkKillSwitch(opts.cwd)) {
        log.warn({ iteration: iteration - 1 }, "Kill switch active — stopping");
        return {
          exitReason: "kill-switch",
          iterations: iteration - 1,
          message: `Kill switch active (.agent/autopilot-disable exists). Stopping after ${iteration - 1} iteration(s).`,
        };
      }

      // Check total timeout
      if (Date.now() - startTime >= timeoutMs) {
        log.warn({ iteration: iteration - 1, timeoutMs }, "Total timeout exceeded");
        return {
          exitReason: "timeout",
          iterations: iteration - 1,
          message: `Total timeout (${timeoutMs}ms) exceeded after ${iteration - 1} iteration(s).`,
        };
      }

      // Record git HEAD before this iteration for progress tracking
      const headBefore = await getHeadSha(opts.cwd);

      const iterStart = Date.now();
      log.info({ iteration, maxIterations }, `Iteration ${iteration}/${maxIterations} — sending prompt`);

      // Tool-call events go through pino at `debug` level. Default stderr
      // level is `info`, so users don't see tool chatter by default — but
      // the file sink captures everything. Set GLRS_LOG_LEVEL=debug (or
      // pass the CLI flag wired to it) to see tool calls live.
      const result = await _sendAndWait(server.client, {
        sessionId,
        message: fullPrompt,
        stallMs,
        abortSignal: abort.signal,
        onToolCall: (toolName) => {
          toolLog.debug({ iteration, tool: toolName }, toolName);
        },
      });

      const iterDurationMs = Date.now() - iterStart;

      if (result.kind === "abort") {
        log.warn({ iteration, iterDurationMs }, "Iteration aborted (total timeout)");
        return {
          exitReason: "timeout",
          iterations: iteration,
          message: `Aborted after ${iteration} iteration(s) (total timeout exceeded).`,
        };
      }

      if (result.kind === "stall") {
        log.warn({ iteration, stallMs: result.stallMs }, "Iteration stalled");
        return {
          exitReason: "stall",
          iterations: iteration,
          message: `Iteration ${iteration} stalled for ${result.stallMs}ms with no idle signal.`,
        };
      }

      if (result.kind === "error") {
        log.error({ iteration, err: result.message }, "Iteration errored");
        return {
          exitReason: "error",
          iterations: iteration,
          message: `Error in iteration ${iteration}: ${result.message}`,
        };
      }

      // result.kind === "idle" — check for sentinel FIRST.
      // An agent that emits <autopilot-done> on a zero-progress iteration
      // (e.g., "I'm confirming completion; previous iterations wrote all the
      // files") must exit as "sentinel", NOT be counted toward struggle.
      // Sentinel check must happen before struggle accounting.
      const lastMessage = await _getLastAssistantMessage(server.client, sessionId);
      if (detectSentinel(lastMessage)) {
        log.info({ iteration, iterDurationMs }, "Sentinel detected — autopilot done");
        return {
          exitReason: "sentinel",
          iterations: iteration,
          message: `Agent emitted <autopilot-done> at iteration ${iteration}.`,
        };
      }

      // No sentinel — record progress and check struggle.
      // Only reached when the agent did NOT emit the sentinel this iteration.
      const madeProgress = await checkProgress(opts.cwd, headBefore);
      struggle.record(madeProgress);

      log.info(
        { iteration, iterDurationMs, madeProgress },
        `Iteration ${iteration} idle (${(iterDurationMs / 1000).toFixed(1)}s, ${madeProgress ? "progress" : "no progress"})`,
      );

      if (struggle.isStruggling()) {
        log.warn({ iteration, struggleThreshold }, "Struggle detected — stopping");
        return {
          exitReason: "struggle",
          iterations: iteration,
          message: `Agent made no filesystem progress for ${struggleThreshold} consecutive iteration(s). Stopping at iteration ${iteration}.`,
        };
      }
    }

    log.warn({ maxIterations }, "Reached max iterations");
    return {
      exitReason: "max-iterations",
      iterations: maxIterations,
      message: `Reached maximum iterations (${maxIterations}). Stopping.`,
    };
  } finally {
    clearTimeout(timeoutHandle);
    log.info({}, "Shutting down server");
    await server.shutdown();
    await autopilotLog.flush();
  }
}
