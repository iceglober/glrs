/**
 * Anthropic Messages API ↔ canonical IR.
 *
 * Decodes incoming POST /v1/messages JSON to a ChatRequest, and encodes
 * IR StreamEvents to the Anthropic-flavored SSE byte stream the client expects.
 *
 * Reference: https://docs.anthropic.com/en/api/messages
 */

import type {
  ChatRequest,
  ContentBlock,
  Message,
  StreamEvent,
  StopReason,
  SystemBlock,
  ToolSchema,
} from "../types.js";

// ── decode (request → IR) ───────────────────────────────────────────────────

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: unknown }>;
  system?: string | Array<{ type: "text"; text: string }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export interface DecodedRequest extends ChatRequest {
  stream: boolean;
}

export function decodeAnthropicRequest(raw: unknown): DecodedRequest {
  if (!raw || typeof raw !== "object") {
    throw new BadRequest("request body must be a JSON object");
  }
  const body = raw as AnthropicRequestBody;
  if (typeof body.model !== "string") throw new BadRequest("`model` is required");
  if (typeof body.max_tokens !== "number")
    throw new BadRequest("`max_tokens` is required");
  if (!Array.isArray(body.messages))
    throw new BadRequest("`messages` is required");

  return {
    model: body.model,
    requestedModel: body.model,
    maxTokens: body.max_tokens,
    system: decodeSystem(body.system),
    messages: body.messages.map(decodeMessage),
    tools: body.tools?.map(decodeTool),
    temperature: body.temperature,
    topP: body.top_p,
    stopSequences: body.stop_sequences,
    stream: body.stream === true,
  };
}

function decodeSystem(
  raw: AnthropicRequestBody["system"],
): SystemBlock[] {
  if (raw === undefined) return [];
  if (typeof raw === "string") return raw ? [{ text: raw }] : [];
  if (Array.isArray(raw)) {
    return raw
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => ({ text: b.text }));
  }
  throw new BadRequest("`system` must be a string or array of text blocks");
}

function decodeMessage(raw: { role: string; content: unknown }): Message {
  if (raw.role !== "user" && raw.role !== "assistant") {
    throw new BadRequest(`unsupported message role: ${raw.role}`);
  }
  return { role: raw.role, content: decodeContent(raw.content) };
}

function decodeContent(raw: unknown): ContentBlock[] {
  if (typeof raw === "string") {
    return raw ? [{ type: "text", text: raw }] : [];
  }
  if (!Array.isArray(raw)) {
    throw new BadRequest("message content must be a string or array");
  }
  return raw.map(decodeBlock);
}

function decodeBlock(raw: unknown): ContentBlock {
  if (!raw || typeof raw !== "object") {
    throw new BadRequest("content block must be an object");
  }
  const b = raw as { type: string; [k: string]: unknown };
  switch (b.type) {
    case "text":
      return { type: "text", text: String(b.text ?? "") };
    case "tool_use":
      return {
        type: "tool_use",
        id: String(b.id ?? ""),
        name: String(b.name ?? ""),
        input: b.input ?? {},
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: String(b.tool_use_id ?? ""),
        content: decodeToolResultContent(b.content),
        isError: b.is_error === true,
      };
    case "image": {
      const src = b.source as
        | { type: string; media_type: string; data: string }
        | undefined;
      if (!src || src.type !== "base64") {
        throw new BadRequest("only base64 image sources are supported");
      }
      return { type: "image", mediaType: src.media_type, data: src.data };
    }
    default:
      throw new BadRequest(`unsupported content block type: ${b.type}`);
  }
}

function decodeToolResultContent(
  raw: unknown,
): Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string }> {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") {
    return raw ? [{ type: "text", text: raw }] : [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((b) => decodeBlock(b))
      .filter(
        (b): b is { type: "text"; text: string } | { type: "image"; mediaType: string; data: string } =>
          b.type === "text" || b.type === "image",
      );
  }
  throw new BadRequest("tool_result content must be a string or array");
}

function decodeTool(raw: {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}): ToolSchema {
  return {
    name: raw.name,
    description: raw.description,
    inputSchema: raw.input_schema,
  };
}

export class BadRequest extends Error {
  readonly status = 400;
  constructor(msg: string) {
    super(msg);
    this.name = "BadRequest";
  }
}

// ── encode (IR stream → Anthropic SSE bytes) ─────────────────────────────────

const SR_OUT: Record<StopReason, string> = {
  end_turn: "end_turn",
  max_tokens: "max_tokens",
  stop_sequence: "stop_sequence",
  tool_use: "tool_use",
  guardrail_intervened: "end_turn", // Anthropic has no native equivalent
  content_filtered: "end_turn",
  other: "end_turn",
};

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Build the Anthropic SSE response stream from IR events.
 * Returns a ReadableStream of Uint8Array.
 */
export function encodeAnthropicSse(
  events: AsyncIterable<StreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of events) {
          const frames = encodeEvent(ev);
          for (const f of frames) controller.enqueue(encoder.encode(f));
        }
        controller.close();
      } catch (err) {
        // Emit an Anthropic-style error event then close. Don't `controller.error`
        // because that aborts the SSE without a final frame; clients tolerate a
        // graceful close better.
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            sseFrame("error", {
              type: "error",
              error: { type: "api_error", message },
            }),
          ),
        );
        controller.close();
      }
    },
  });
}

function encodeEvent(ev: StreamEvent): string[] {
  switch (ev.type) {
    case "message_start":
      return [
        sseFrame("message_start", {
          type: "message_start",
          message: {
            id: ev.messageId,
            type: "message",
            role: "assistant",
            model: ev.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
      ];
    case "content_block_start": {
      const cb =
        ev.block.type === "text"
          ? { type: "text", text: "" }
          : {
              type: "tool_use",
              id: ev.block.id,
              name: ev.block.name,
              input: {},
            };
      return [
        sseFrame("content_block_start", {
          type: "content_block_start",
          index: ev.index,
          content_block: cb,
        }),
      ];
    }
    case "content_block_delta": {
      const delta =
        ev.delta.type === "text_delta"
          ? { type: "text_delta", text: ev.delta.text }
          : { type: "input_json_delta", partial_json: ev.delta.partialJson };
      return [
        sseFrame("content_block_delta", {
          type: "content_block_delta",
          index: ev.index,
          delta,
        }),
      ];
    }
    case "content_block_stop":
      return [
        sseFrame("content_block_stop", {
          type: "content_block_stop",
          index: ev.index,
        }),
      ];
    case "message_delta": {
      const delta: Record<string, unknown> = {};
      if (ev.stopReason) delta.stop_reason = SR_OUT[ev.stopReason];
      if (ev.stopSequence) delta.stop_sequence = ev.stopSequence;
      const usage: Record<string, number> = {};
      if (ev.usage?.outputTokens !== undefined) usage.output_tokens = ev.usage.outputTokens;
      if (ev.usage?.inputTokens !== undefined) usage.input_tokens = ev.usage.inputTokens;
      if (ev.usage?.cacheReadInputTokens !== undefined)
        usage.cache_read_input_tokens = ev.usage.cacheReadInputTokens;
      if (ev.usage?.cacheWriteInputTokens !== undefined)
        usage.cache_creation_input_tokens = ev.usage.cacheWriteInputTokens;
      return [
        sseFrame("message_delta", {
          type: "message_delta",
          delta,
          usage,
        }),
      ];
    }
    case "message_stop":
      return [sseFrame("message_stop", { type: "message_stop" })];
    case "error":
      return [
        sseFrame("error", {
          type: "error",
          error: { type: ev.error.type, message: ev.error.message },
        }),
      ];
  }
}
