/**
 * Canonical message IR. The proxy decodes ingress requests (Anthropic Messages
 * today; OpenAI/Bedrock-Converse later) into this shape, and providers
 * translate it out to whatever their backend wants.
 *
 * Shape is Bedrock-flavored: `system` separated from `messages`, content always
 * an array of typed blocks. Anthropic's wire format flattens these — we
 * unflatten so the IR is one source of truth and translators are pure.
 */

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type ToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  content: Array<TextBlock | ImageBlock>;
  isError?: boolean;
};
export type ImageBlock = {
  type: "image";
  mediaType: string;
  data: string; // base64
};

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock;

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface SystemBlock {
  text: string;
}

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>; // JSON Schema object
}

export interface ChatRequest {
  model: string;
  system: SystemBlock[];
  messages: Message[];
  tools?: ToolSchema[];
  maxTokens: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  /**
   * The model ID the *client* asked for (before any aliasing). Carried through
   * for logging/telemetry; providers ignore it and use `model`.
   */
  requestedModel?: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "guardrail_intervened"
  | "content_filtered"
  | "other";

/**
 * Streaming events — Anthropic-style for ergonomic translation back to SSE.
 * Bedrock Converse stream events translate INTO this shape; the Anthropic
 * ingress translates this shape OUT to SSE.
 */
export type StreamEvent =
  | { type: "message_start"; messageId: string; model: string }
  | {
      type: "content_block_start";
      index: number;
      block: TextBlock | ToolUseBlock;
    }
  | {
      type: "content_block_delta";
      index: number;
      delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partialJson: string };
    }
  | { type: "content_block_stop"; index: number }
  | {
      type: "message_delta";
      stopReason?: StopReason;
      stopSequence?: string;
      usage?: Partial<UsageInfo>;
    }
  | { type: "message_stop" }
  | { type: "error"; error: { type: string; message: string } };

export interface Provider {
  readonly name: string;
  /** Streams events. Non-streaming chat is built on top of this in v0. */
  stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
}
