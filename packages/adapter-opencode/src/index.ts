/**
 * @glrs-dev/adapter-opencode — OpenCode agent adapter.
 *
 * Exports the OpenCode server lifecycle helpers and the AgentAdapter
 * implementation wrapping them.
 */

export {
  startServer,
  selfTest,
  createSession,
  sendAndWait,
  waitForIdle,
  getSessionCost,
  getSessionStats,
  getLastAssistantMessage,
  execFileP,
  DEFAULT_STARTUP_TIMEOUT_MS,
} from "./opencode-adapter.js";
export type { StartedServer, SessionResult as OpenCodeSessionResult } from "./opencode-adapter.js";

export { extractServerError, enhanceSessionError } from "./server-error-extractor.js";

export { OpenCodeAdapter } from "./opencode-adapter-class.js";
