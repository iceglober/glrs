/**
 * Canonical IR ↔ Bedrock Converse request/response.
 *
 * Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference-call.html
 *            https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html
 */

import type {
  ChatRequest,
  ContentBlock,
  Message,
  StopReason,
  StreamEvent,
  ToolResultBlock,
  ToolSchema,
} from "../types.js";

import type {
  ContentBlock as BRContentBlock,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
  ImageFormat,
  Message as BRMessage,
  StopReason as BRStopReason,
  SystemContentBlock,
  Tool,
  ToolResultBlock as BRToolResultBlock,
} from "@aws-sdk/client-bedrock-runtime";

// Mirror of @smithy/types `DocumentType`. We don't import it directly because
// @smithy/types isn't a direct dep, and adding a dep just for one structural
// type is overkill — it's just recursive JSON.
type DocumentType =
  | null
  | boolean
  | number
  | string
  | DocumentType[]
  | { [prop: string]: DocumentType };

// ── IR → Converse input ──────────────────────────────────────────────────────

export function toConverseInput(
  req: ChatRequest,
  modelId: string,
): ConverseStreamCommandInput {
  const input: ConverseStreamCommandInput = {
    modelId,
    messages: req.messages.map(toBedrockMessage),
    inferenceConfig: {
      maxTokens: req.maxTokens,
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.topP !== undefined && { topP: req.topP }),
      ...(req.stopSequences && req.stopSequences.length > 0
        ? { stopSequences: req.stopSequences }
        : {}),
    },
  };
  if (req.system.length > 0) {
    input.system = req.system.map(
      (b): SystemContentBlock => ({ text: b.text }),
    );
  }
  if (req.tools && req.tools.length > 0) {
    input.toolConfig = { tools: req.tools.map(toBedrockTool) };
  }
  return input;
}

function toBedrockMessage(m: Message): BRMessage {
  return {
    role: m.role,
    content: m.content.map(toBedrockBlock),
  };
}

function toBedrockBlock(b: ContentBlock): BRContentBlock {
  switch (b.type) {
    case "text":
      return { text: b.text };
    case "tool_use":
      return {
        toolUse: {
          toolUseId: b.id,
          name: b.name,
          input: (b.input ?? {}) as DocumentType,
        },
      };
    case "tool_result":
      return { toolResult: toBedrockToolResult(b) };
    case "image":
      return {
        image: {
          format: imageFormat(b.mediaType),
          source: { bytes: base64ToBytes(b.data) },
        },
      };
  }
}

function toBedrockToolResult(b: ToolResultBlock): BRToolResultBlock {
  const content: BRToolResultBlock["content"] = b.content.map((c) => {
    if (c.type === "text") return { text: c.text };
    return {
      image: {
        format: imageFormat(c.mediaType),
        source: { bytes: base64ToBytes(c.data) },
      },
    };
  });
  return {
    toolUseId: b.toolUseId,
    content,
    ...(b.isError ? { status: "error" } : {}),
  };
}

function toBedrockTool(t: ToolSchema): Tool {
  return {
    toolSpec: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      inputSchema: { json: t.inputSchema as DocumentType },
    },
  };
}

function imageFormat(mediaType: string): ImageFormat {
  const m = mediaType.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpeg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  // Bedrock will reject unknown — let it. Throwing here would lose useful
  // detail; the upstream error message names the field clearly.
  return "png";
}

function base64ToBytes(b64: string): Uint8Array {
  // atob is fine in Bun/Node 18+.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Converse stream → IR events ──────────────────────────────────────────────

const STOP_REASON_IN: Record<string, StopReason> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  stop_sequence: "stop_sequence",
  guardrail_intervened: "guardrail_intervened",
  content_filtered: "content_filtered",
};

interface StreamCtx {
  messageId: string;
  model: string;
  /**
   * Bedrock omits contentBlockStart for text blocks — the first contentBlockDelta
   * is our cue to synthesize one. We track which indexes we've opened.
   */
  openedBlocks: Set<number>;
  messageStarted: boolean;
}

/**
 * Translate the Bedrock ConverseStream output iterator into IR StreamEvents.
 */
export async function* fromConverseStream(
  source: AsyncIterable<ConverseStreamOutput>,
  ctx: { messageId: string; model: string },
): AsyncGenerator<StreamEvent> {
  const state: StreamCtx = {
    messageId: ctx.messageId,
    model: ctx.model,
    openedBlocks: new Set(),
    messageStarted: false,
  };

  for await (const chunk of source) {
    if (chunk.messageStart) {
      if (!state.messageStarted) {
        state.messageStarted = true;
        yield {
          type: "message_start",
          messageId: state.messageId,
          model: state.model,
        };
      }
      continue;
    }

    if (chunk.contentBlockStart) {
      const idx = chunk.contentBlockStart.contentBlockIndex ?? 0;
      const toolUse = chunk.contentBlockStart.start?.toolUse;
      if (toolUse) {
        state.openedBlocks.add(idx);
        yield {
          type: "content_block_start",
          index: idx,
          block: {
            type: "tool_use",
            id: toolUse.toolUseId ?? "",
            name: toolUse.name ?? "",
            input: {},
          },
        };
      }
      continue;
    }

    if (chunk.contentBlockDelta) {
      const idx = chunk.contentBlockDelta.contentBlockIndex ?? 0;
      const delta = chunk.contentBlockDelta.delta;
      // Synthesize a content_block_start for text blocks Bedrock didn't open.
      if (!state.openedBlocks.has(idx)) {
        state.openedBlocks.add(idx);
        if (delta?.text !== undefined) {
          yield {
            type: "content_block_start",
            index: idx,
            block: { type: "text", text: "" },
          };
        }
        // For tool-use deltas without a prior start, we already added; if we
        // ever see toolUse deltas without a start, Bedrock has changed shape
        // — treat as no-op for that frame rather than crash.
      }
      if (delta?.text !== undefined) {
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "text_delta", text: delta.text },
        };
      } else if (delta?.toolUse?.input !== undefined) {
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "input_json_delta", partialJson: delta.toolUse.input },
        };
      }
      continue;
    }

    if (chunk.contentBlockStop) {
      const idx = chunk.contentBlockStop.contentBlockIndex ?? 0;
      if (state.openedBlocks.has(idx)) {
        yield { type: "content_block_stop", index: idx };
      }
      continue;
    }

    if (chunk.messageStop) {
      const reason = mapStopReason(chunk.messageStop.stopReason);
      yield { type: "message_delta", stopReason: reason };
      continue;
    }

    if (chunk.metadata) {
      const u = chunk.metadata.usage;
      if (u) {
        yield {
          type: "message_delta",
          usage: {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            ...(u.cacheReadInputTokens !== undefined && {
              cacheReadInputTokens: u.cacheReadInputTokens,
            }),
            ...(u.cacheWriteInputTokens !== undefined && {
              cacheWriteInputTokens: u.cacheWriteInputTokens,
            }),
          },
        };
      }
      continue;
    }

    // Error events surface via the AWS SDK as thrown exceptions, but the stream
    // shape also includes exception fields. If one shows up, propagate as an
    // IR error event and stop iterating.
    const errMsg =
      chunk.internalServerException?.message ??
      chunk.modelStreamErrorException?.message ??
      chunk.validationException?.message ??
      chunk.throttlingException?.message ??
      chunk.serviceUnavailableException?.message;
    if (errMsg) {
      yield { type: "error", error: { type: "bedrock_error", message: errMsg } };
      return;
    }
  }

  yield { type: "message_stop" };
}

function mapStopReason(raw: BRStopReason | string | undefined): StopReason {
  if (!raw) return "other";
  return STOP_REASON_IN[raw] ?? "other";
}
