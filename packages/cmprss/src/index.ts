/**
 * @glrs-dev/cmprss — public library entry.
 *
 * v0 exports just enough surface for someone to embed the proxy in their own
 * Bun process or build a custom provider. The full plan (compress, MCP, CCR)
 * comes in later versions.
 */

export { createProxy, startProxy } from "./proxy/server.js";
export type { ProxyHandle, ProxyOptions } from "./proxy/server.js";

export {
  BedrockConverseProvider,
} from "./providers/bedrock-converse/provider.js";
export type { BedrockProviderOptions } from "./providers/bedrock-converse/provider.js";

export type {
  ChatRequest,
  ContentBlock,
  Message,
  Provider,
  StreamEvent,
  SystemBlock,
  ToolSchema,
  UsageInfo,
} from "./providers/types.js";

export {
  resolveModel,
  regionPrefix,
  ModelNotFound,
} from "./aws/model-resolver.js";

export {
  defaultCredentials,
  assertCredentialsAvailable,
  NoCredentials,
} from "./auth/credentials.js";
