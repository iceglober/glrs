/**
 * ClaudeCodeCliAdapter — implements AgentAdapter using the Claude Code CLI.
 *
 * Wraps the low-level claude-code-cli.ts helpers into the AgentAdapter
 * interface so the autopilot loop engine can drive Claude Code without
 * importing execa directly.
 *
 * Each sendAndWait call spawns a `claude -p` subprocess with
 * --output-format stream-json. Sessions persist across calls via
 * --resume <sessionId>.
 *
 * Named "cli" to distinguish from a future SDK-based adapter.
 */

import type {
  AgentAdapter,
  AgentHandle,
  AdapterSessionResult as SessionResult,
} from "@glrs-dev/autopilot";
import {
  ensureClaudeOnPath,
  sendMessage,
} from "./claude-code-cli.js";
import type { ClaudeCodeAdapterOptions } from "./claude-code-cli.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

interface SessionData {
  /** Real Claude Code session ID, captured from the first sendAndWait result. */
  realSessionId?: string;
  /** Resolved model for this session (based on agentName at creation). */
  model?: string;
  lastResponse: string;
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

class ClaudeCodeHandle implements AgentHandle {
  readonly id: string;
  readonly cwd: string;
  readonly sessions = new Map<string, SessionData>();

  constructor(cwd: string) {
    this.id = `claude-code:${cwd}`;
    this.cwd = cwd;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeCodeCliAdapter implements AgentAdapter {
  readonly name = "claude-code-cli";
  private readonly opts: ClaudeCodeAdapterOptions;

  constructor(opts?: ClaudeCodeAdapterOptions) {
    this.opts = opts ?? {};
  }

  async start(opts: { cwd: string }): Promise<AgentHandle> {
    await ensureClaudeOnPath();
    return new ClaudeCodeHandle(opts.cwd);
  }

  async createSession(
    handle: AgentHandle,
    opts: { agentName?: string },
  ): Promise<string> {
    const h = handle as ClaudeCodeHandle;
    const placeholderId = randomUUID();
    h.sessions.set(placeholderId, {
      model: this.resolveModel(opts.agentName),
      lastResponse: "",
      totalCost: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
    });
    return placeholderId;
  }

  private resolveModel(agentName?: string): string | undefined {
    const { models, model } = this.opts;
    if (!models) return model;
    if (agentName === "autopilot-fast") return models.execute ?? model;
    // "prime", "autopilot-prime", or undefined → enrichment/deep tier
    return models.enrich ?? model;
  }

  async sendAndWait(
    handle: AgentHandle,
    opts: {
      sessionId: string;
      message: string;
      stallMs?: number;
      abortSignal?: AbortSignal;
      onToolCall?: (name: string, arg?: string) => void;
      onTextDelta?: (chars: number) => void;
      onCostUpdate?: (
        cost: number,
        tokens: { input: number; output: number },
      ) => void;
    },
  ): Promise<SessionResult> {
    const h = handle as ClaudeCodeHandle;
    const session = h.sessions.get(opts.sessionId);
    if (!session) {
      return { kind: "error", message: `Unknown session: ${opts.sessionId}` };
    }

    // Override the adapter-level model with the session's resolved model
    const adapterOpts = session.model
      ? { ...this.opts, model: session.model }
      : this.opts;

    const result = await sendMessage({
      cwd: h.cwd,
      message: opts.message,
      sessionId: session.realSessionId,
      adapterOpts,
      stallMs: opts.stallMs,
      abortSignal: opts.abortSignal,
      onToolCall: opts.onToolCall,
      onTextDelta: opts.onTextDelta,
      onCostUpdate: opts.onCostUpdate,
    });

    // Capture the real session ID from the first response
    if (!session.realSessionId && result.sessionId) {
      session.realSessionId = result.sessionId;
    }

    // Accumulate stats
    session.lastResponse = result.response;
    session.totalCost += result.cost;
    session.totalTokensIn += result.tokensIn;
    session.totalTokensOut += result.tokensOut;

    // Map to SessionResult
    if (opts.abortSignal?.aborted) {
      return { kind: "abort" };
    }
    if (result.isError && result.errorMessage?.includes("Stalled after")) {
      return { kind: "stall", stallMs: opts.stallMs ?? 60 * 60 * 1000 };
    }
    if (result.isError) {
      return { kind: "error", message: result.errorMessage ?? "unknown error" };
    }
    return { kind: "idle" };
  }

  async getLastResponse(
    handle: AgentHandle,
    sessionId: string,
  ): Promise<string> {
    const h = handle as ClaudeCodeHandle;
    return h.sessions.get(sessionId)?.lastResponse ?? "";
  }

  async getSessionCost(
    handle: AgentHandle,
    sessionId: string,
  ): Promise<number> {
    const h = handle as ClaudeCodeHandle;
    return h.sessions.get(sessionId)?.totalCost ?? 0;
  }

  async getSessionStats(
    handle: AgentHandle,
    sessionId: string,
  ): Promise<{ cost: number; tokensIn: number; tokensOut: number }> {
    const h = handle as ClaudeCodeHandle;
    const session = h.sessions.get(sessionId);
    if (!session) return { cost: 0, tokensIn: 0, tokensOut: 0 };
    return {
      cost: session.totalCost,
      tokensIn: session.totalTokensIn,
      tokensOut: session.totalTokensOut,
    };
  }

  async shutdown(_handle: AgentHandle): Promise<void> {
    // No persistent server to shut down — each sendAndWait is a
    // self-contained subprocess.
  }

  async enhanceError(message: string): Promise<string> {
    if (message.includes("claude CLI not found")) {
      return (
        message +
        "\n\nThe Claude Code CLI is required for this adapter. " +
        "Install it with: npm install -g @anthropic-ai/claude-code"
      );
    }
    return message;
  }
}
