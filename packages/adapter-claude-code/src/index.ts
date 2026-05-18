/**
 * @glrs-dev/adapter-claude-code — Claude Code CLI agent adapter.
 *
 * Exports the Claude Code CLI helpers and the AgentAdapter
 * implementation wrapping them.
 */

export { ensureClaudeOnPath, sendMessage } from "./claude-code-cli.js";
export type {
  ClaudeCodeAdapterOptions,
  SendResult as ClaudeCodeSendResult,
} from "./claude-code-cli.js";

export { ClaudeCodeCliAdapter } from "./claude-code-adapter.js";
