/**
 * OpenCodeAdapter — implements AgentAdapter using the OpenCode SDK.
 *
 * Wraps the low-level opencode-server.ts functions into the AgentAdapter
 * interface so the autopilot loop engine can drive OpenCode without
 * importing the SDK directly.
 */

import type { AgentAdapter, AgentHandle, AdapterSessionResult as SessionResult } from "@glrs-dev/autopilot";
import {
  startServer,
  createSession,
  sendAndWait,
  getLastAssistantMessage,
  getSessionCost,
  getSessionStats,
} from "./opencode-adapter.js";
import type { StartedServer } from "./opencode-adapter.js";
import { enhanceSessionError } from "./server-error-extractor.js";

/**
 * AgentHandle implementation for OpenCode.
 * Wraps a StartedServer so the adapter can manage its lifecycle.
 */
class OpenCodeHandle implements AgentHandle {
  readonly id: string;
  readonly server: StartedServer;
  readonly cwd: string;

  constructor(server: StartedServer, cwd: string) {
    this.server = server;
    this.cwd = cwd;
    this.id = server.url;
  }
}

/**
 * OpenCode implementation of AgentAdapter.
 * Creates and manages OpenCode server instances.
 */
export class OpenCodeAdapter implements AgentAdapter {
  readonly name = "opencode";

  async start(opts: { cwd: string }): Promise<AgentHandle> {
    const server = await startServer({ cwd: opts.cwd });
    return new OpenCodeHandle(server, opts.cwd);
  }

  async createSession(handle: AgentHandle, opts: { agentName?: string }): Promise<string> {
    const h = handle as OpenCodeHandle;
    return createSession(h.server.client, {
      cwd: h.cwd,
      agentName: opts.agentName,
    });
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
      onCostUpdate?: (cost: number, tokens: { input: number; output: number }) => void;
    },
  ): Promise<SessionResult> {
    const h = handle as OpenCodeHandle;
    const result = await sendAndWait(h.server.client, {
      sessionId: opts.sessionId,
      message: opts.message,
      stallMs: opts.stallMs,
      abortSignal: opts.abortSignal,
      onToolCall: opts.onToolCall,
      onTextDelta: opts.onTextDelta,
      onCostUpdate: opts.onCostUpdate,
      autoRejectPermissions: true,
      serverUrl: h.server.url,
    });
    // Map the opencode-server SessionResult to the adapter SessionResult
    // The opencode-server uses a discriminated union; the adapter uses an interface.
    return result as unknown as SessionResult;
  }

  async getLastResponse(handle: AgentHandle, sessionId: string): Promise<string> {
    const h = handle as OpenCodeHandle;
    return getLastAssistantMessage(h.server.client, sessionId);
  }

  async getSessionCost(handle: AgentHandle, sessionId: string): Promise<number> {
    const h = handle as OpenCodeHandle;
    return getSessionCost(h.server.client, sessionId);
  }

  async getSessionStats(handle: AgentHandle, sessionId: string): Promise<{
    cost: number;
    tokensIn: number;
    tokensOut: number;
  }> {
    const h = handle as OpenCodeHandle;
    return getSessionStats(h.server.client, sessionId);
  }

  async shutdown(handle: AgentHandle): Promise<void> {
    const h = handle as OpenCodeHandle;
    await h.server.shutdown();
  }

  async enhanceError(message: string): Promise<string> {
    return enhanceSessionError(message);
  }
}
