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
import {
  bedrockFromAnthropic,
  ModelNotFound,
} from "../../aws/model-resolver.js";
import { randomToken } from "../../lib/id.js";
import { fromConverseStream, toConverseInput } from "./translate.js";

export interface BedrockProviderOptions {
  region: string;
  /**
   * Optional credentials provider. Omit to use the AWS SDK's default chain
   * (env, profile, SSO, IRSA, IMDS).
   */
  credentials?: BedrockRuntimeClientConfig["credentials"];
  /**
   * Per-request model translator. The proxy calls this with the model name
   * the harness sent (typically an anthropic API name like
   * `claude-sonnet-4-5-20250929`) and must return a Bedrock inference profile
   * ID for the configured region. Defaults to the bundled
   * `bedrockFromAnthropic(model, region)` which knows the claude-4.x family.
   *
   * Throw `ModelNotFound` (or any Error with `.status = 400`) to surface a
   * 400 to the client; anything else becomes a 5xx.
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
    const region = opts.region;
    this.resolveModel =
      opts.resolveModel ??
      ((m) => {
        const id = bedrockFromAnthropic(m, region);
        if (!id) throw new ModelNotFound(m, region);
        return id;
      });
  }

  async *stream(
    req: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const modelId = this.resolveModel(req.model);
    const input = toConverseInput(req, modelId);

    const messageId = `msg_${randomToken()}`;
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

