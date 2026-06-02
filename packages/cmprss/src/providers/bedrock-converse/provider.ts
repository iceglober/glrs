/**
 * Bedrock Converse provider — SigV4 signing via @aws-sdk/client-bedrock-runtime.
 * No hand-rolled crypto. Streaming-only for v0 (Claude Code always streams).
 */

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  BedrockRuntimeClientConfig,
  ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";

import type { ChatRequest, Provider, StreamEvent } from "../types.js";
import { fromConverseStream, toConverseInput } from "./translate.js";

export interface BedrockProviderOptions {
  region: string;
  /**
   * Optional credentials provider. Omit to use the AWS SDK's default chain
   * (env, profile, SSO, IRSA, IMDS).
   */
  credentials?: BedrockRuntimeClientConfig["credentials"];
  /**
   * Map the IR-level `model` string to the Bedrock model ID / inference profile
   * ARN actually invoked. Short names like "sonnet" are resolved upstream
   * (see src/aws/model-resolver.ts); this hook lets callers override late.
   */
  resolveModel?: (model: string) => string;
}

export class BedrockConverseProvider implements Provider {
  readonly name = "bedrock-converse";
  private readonly client: BedrockRuntimeClient;
  private readonly resolveModel: (m: string) => string;

  constructor(opts: BedrockProviderOptions) {
    this.client = new BedrockRuntimeClient({
      region: opts.region,
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    });
    this.resolveModel = opts.resolveModel ?? ((m) => m);
  }

  async *stream(
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const modelId = this.resolveModel(req.model);
    const input = toConverseInput(req, modelId);

    const messageId = `msg_${cryptoRandomId()}`;
    const cmd = new ConverseStreamCommand(input);
    const resp = await this.client.send(cmd, { abortSignal: signal });

    if (!resp.stream) {
      yield {
        type: "error",
        error: {
          type: "bedrock_error",
          message: "Bedrock returned no stream body",
        },
      };
      return;
    }

    yield* fromConverseStream(asAsyncIterable(resp.stream), {
      messageId,
      model: modelId,
    });
  }
}

function asAsyncIterable(
  stream: AsyncIterable<ConverseStreamOutput>,
): AsyncIterable<ConverseStreamOutput> {
  return stream;
}

function cryptoRandomId(): string {
  // Bun has crypto.randomUUID; fall back to a short random hex.
  const uuid =
    (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  if (uuid) return uuid().replaceAll("-", "");
  return Math.random().toString(16).slice(2, 18);
}
