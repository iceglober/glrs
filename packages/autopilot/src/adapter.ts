/**
 * AgentAdapter — abstract interface for driving an AI agent programmatically.
 *
 * Decouples the autopilot loop engine from any specific agent implementation
 * (OpenCode, Claude Code, etc.). The concrete adapter is injected at runtime
 * by the CLI command.
 */

export interface AgentHandle {
  readonly id: string;
}

export interface SessionResult {
  kind: "idle" | "error" | "stall" | "abort" | "question_rejected";
  message?: string;
  stallMs?: number;
  title?: string;
}

export interface AgentAdapter {
  readonly name: string;
  start(opts: { cwd: string }): Promise<AgentHandle>;
  createSession(handle: AgentHandle, opts: { agentName?: string }): Promise<string>;
  sendAndWait(
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
  ): Promise<SessionResult>;
  getLastResponse(handle: AgentHandle, sessionId: string): Promise<string>;
  getSessionCost(handle: AgentHandle, sessionId: string): Promise<number>;
  /** Return cost + token totals for a session. Optional — callers fall back to getSessionCost when absent. */
  getSessionStats?(handle: AgentHandle, sessionId: string): Promise<{
    cost: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  shutdown(handle: AgentHandle): Promise<void>;
  enhanceError?(message: string): Promise<string>;
}
