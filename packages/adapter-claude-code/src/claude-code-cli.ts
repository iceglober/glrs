/**
 * Low-level helpers for driving the Claude Code CLI (`claude`) via execa.
 *
 * Spawns `claude -p` in stream-json mode, parses newline-delimited JSON
 * events from stdout, and fires callbacks for tool calls, text output,
 * and cost updates. Handles stall detection and abort signals.
 */

import { execa, type ResultPromise } from "execa";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeAdapterOptions {
  /** Default model for all sessions (overridden by per-tier models). */
  model?: string;
  /** Per-tier model overrides keyed by autopilot role. */
  models?: {
    /** Model for enrichment sessions (agentName "prime" / "autopilot-prime"). */
    enrich?: string;
    /** Model for execution sessions (agentName "autopilot-fast"). */
    execute?: string;
  };
  dangerouslySkipPermissions?: boolean;
  maxTurns?: number;
  allowedTools?: string[];
}

export interface SendResult {
  sessionId: string;
  response: string;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  isError: boolean;
  errorMessage?: string;
  numTurns: number;
}

// ---------------------------------------------------------------------------
// Path check
// ---------------------------------------------------------------------------

export async function ensureClaudeOnPath(): Promise<void> {
  try {
    await execa("claude", ["--version"]);
  } catch {
    throw new Error(
      "claude CLI not found on PATH.\n" +
        "  Install: https://docs.anthropic.com/en/docs/claude-code\n" +
        "  Or: npm install -g @anthropic-ai/claude-code",
    );
  }
}

// ---------------------------------------------------------------------------
// Arg extraction (matches adapter-opencode convention)
// ---------------------------------------------------------------------------

const ARG_KEYS = ["filePath", "file_path", "path", "command", "pattern", "query"] as const;

function extractFirstArg(input: Record<string, unknown>): string | undefined {
  for (const key of ARG_KEYS) {
    const val = input[key];
    if (typeof val === "string" && val.length > 0) {
      return val.length > 80 ? val.slice(0, 77) + "..." : val;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core: send a message via the CLI and stream events
// ---------------------------------------------------------------------------

export async function sendMessage(opts: {
  cwd: string;
  message: string;
  sessionId?: string;
  adapterOpts?: ClaudeCodeAdapterOptions;
  stallMs?: number;
  abortSignal?: AbortSignal;
  onToolCall?: (name: string, arg?: string) => void;
  onTextDelta?: (chars: number) => void;
  onCostUpdate?: (
    cost: number,
    tokens: { input: number; output: number },
  ) => void;
}): Promise<SendResult> {
  const args = buildArgs(opts);

  const debug = process.env["GLRS_DEBUG_CLAUDE"] === "1";
  let debugFd: number | null = null;
  const debugLog = debug
    ? (() => {
        const fs = require("node:fs") as typeof import("node:fs");
        debugFd = fs.openSync("/tmp/glrs-claude-debug.log", "a");
        const fd = debugFd;
        return (msg: string) => { try { fs.writeSync(fd, `${new Date().toISOString()} ${msg}\n`); } catch {} };
      })()
    : (_msg: string) => {};

  const subprocess = execa("claude", args, {
    cwd: opts.cwd,
    input: opts.message,
    stdout: "pipe",
    stderr: "pipe",
    reject: false,
  });

  // Capture stderr for error context
  const stderrChunks: string[] = [];
  subprocess.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrChunks.push(text);
    debugLog(`[stderr] ${text.trimEnd()}`);
  });

  const state: ParseState = {
    sessionId: "",
    response: "",
    cost: 0,
    tokensIn: 0,
    tokensOut: 0,
    isError: false,
    errorMessage: undefined,
    numTurns: 0,
  };

  let aborted = false;
  let stalled = false;
  const stallMs = opts.stallMs ?? 60 * 60 * 1000;

  // -- Abort handling -------------------------------------------------------
  const onAbort = () => {
    aborted = true;
    subprocess.kill("SIGTERM");
  };
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      subprocess.kill("SIGTERM");
      await subprocess;
      return { ...state, isError: false };
    }
    opts.abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  // -- Stall detection ------------------------------------------------------
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      subprocess.kill("SIGTERM");
    }, stallMs);
  };
  resetStall();

  // -- Stream parsing -------------------------------------------------------
  try {
    if (subprocess.stdout) {
      const rl = createInterface({ input: subprocess.stdout });
      for await (const line of rl) {
        if (!line.trim()) continue;
        resetStall();
        debugLog(`[event] ${line}`);
        parseEvent(line, state, opts);
      }
    }
  } catch {
    // Stream interrupted (abort/stall kill) — handled below
  }

  // -- Cleanup --------------------------------------------------------------
  if (stallTimer) clearTimeout(stallTimer);
  if (opts.abortSignal) {
    opts.abortSignal.removeEventListener("abort", onAbort);
  }

  const result = await subprocess;

  if (aborted) {
    return { ...state, isError: false };
  }
  if (stalled) {
    return {
      ...state,
      isError: true,
      errorMessage: `Stalled after ${stallMs}ms of inactivity`,
    };
  }
  const stderr = stderrChunks.join("");
  if (result.exitCode !== 0 && !state.isError) {
    state.isError = true;
    state.errorMessage =
      stderr.trim() || `claude exited with code ${result.exitCode}`;
  }
  // If we have a raw-event error and stderr has more context, append it
  if (state.isError && state.errorMessage?.startsWith("claude error (raw:") && stderr.trim()) {
    state.errorMessage = stderr.trim();
  }

  debugLog(`[result] isError=${state.isError} errorMessage=${state.errorMessage ?? "none"} exitCode=${result.exitCode}`);

  if (debugFd !== null) {
    try { (require("node:fs") as typeof import("node:fs")).closeSync(debugFd); } catch {}
  }

  return { ...state };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ParseState {
  sessionId: string;
  response: string;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  isError: boolean;
  errorMessage: string | undefined;
  numTurns: number;
}

function buildArgs(opts: {
  sessionId?: string;
  adapterOpts?: ClaudeCodeAdapterOptions;
}): string[] {
  // -p without a value → reads prompt from stdin
  // --verbose is required when combining --print with --output-format stream-json
  const args: string[] = ["-p", "--output-format", "stream-json", "--verbose"];

  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  }
  if (opts.adapterOpts?.model) {
    args.push("--model", opts.adapterOpts.model);
  }
  if (opts.adapterOpts?.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  if (opts.adapterOpts?.maxTurns != null) {
    args.push("--max-turns", String(opts.adapterOpts.maxTurns));
  }
  if (opts.adapterOpts?.allowedTools?.length) {
    args.push("--allowedTools", opts.adapterOpts.allowedTools.join(","));
  }

  return args;
}

function parseEvent(
  line: string,
  state: ParseState,
  callbacks: {
    onToolCall?: (name: string, arg?: string) => void;
    onTextDelta?: (chars: number) => void;
    onCostUpdate?: (
      cost: number,
      tokens: { input: number; output: number },
    ) => void;
  },
): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  const type = event["type"] as string | undefined;
  if (!type) return;

  // ---- System init: capture session ID ------------------------------------
  if (type === "system" || type === "init") {
    const sid = event["session_id"] as string | undefined;
    if (sid) state.sessionId = sid;
    return;
  }

  // ---- Assistant message: text, tool calls, usage -------------------------
  if (type === "assistant") {
    const msg = event["message"] as Record<string, unknown> | undefined;
    if (!msg) return;

    const content = msg["content"] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        const blockType = block["type"] as string;

        if (blockType === "text" && typeof block["text"] === "string") {
          state.response = block["text"] as string;
          if (callbacks.onTextDelta) {
            try {
              callbacks.onTextDelta((block["text"] as string).length);
            } catch { /* non-fatal */ }
          }
        }

        if (blockType === "tool_use") {
          if (callbacks.onToolCall) {
            const input = block["input"] as Record<string, unknown> | undefined;
            const firstArg = input ? extractFirstArg(input) : undefined;
            try {
              callbacks.onToolCall(
                (block["name"] as string) ?? "unknown",
                firstArg,
              );
            } catch { /* non-fatal */ }
          }
        }
      }
    }

    // Usage tracking
    const usage = msg["usage"] as Record<string, number> | undefined;
    if (usage) {
      state.tokensIn += usage["input_tokens"] ?? 0;
      state.tokensOut += usage["output_tokens"] ?? 0;
    }

    // Session ID may appear here too
    const sid = event["session_id"] as string | undefined;
    if (sid) state.sessionId = sid;
    return;
  }

  // ---- Result event: final summary ----------------------------------------
  if (type === "result") {
    state.sessionId =
      (event["session_id"] as string) || state.sessionId;
    state.cost = (event["cost_usd"] as number) ?? state.cost;
    state.numTurns = (event["num_turns"] as number) ?? state.numTurns;

    if (event["is_error"] === true || event["subtype"] === "error") {
      state.isError = true;
      const errorMsg =
        (typeof event["error"] === "string" && event["error"]) ||
        (typeof event["error_message"] === "string" && event["error_message"]) ||
        (typeof event["message"] === "string" && event["message"]) ||
        (typeof event["result"] === "string" && event["result"]);
      state.errorMessage = errorMsg || `claude error (raw: ${JSON.stringify(event)})`;
    }
  }
}
