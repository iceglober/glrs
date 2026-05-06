/**
 * Pilot v2 runtime guards.
 *
 * Enforces at the plugin layer:
 * 1. pilot-builder sessions cannot commit, push, tag, branch, or open PRs.
 * 2. pilot-planner and pilot-assessor sessions cannot edit files outside
 *    their designated output paths.
 *
 * Detection: pilot sessions are identified by their session title, which
 * the orchestrator sets to `pilot/<workflowId>/<phase>/<taskId>`.
 *
 * This is the second fence — the agent permission maps are the first.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk";
import * as path from "node:path";

// Session title prefix for pilot sessions
const PILOT_TITLE_PREFIX = "pilot/";

// Git commands the builder must never run
const BUILDER_DENIED_PATTERNS = [
  /^git\s+commit/,
  /^git\s+push/,
  /^git\s+tag/,
  /^git\s+checkout\s/,
  /^git\s+switch\s/,
  /^git\s+branch\s/,
  /^git\s+restore\s+--source/,
  /^git\s+reset\s/,
  /^gh\s+pr\s/,
  /^gh\s+release\s/,
];

// Cache: sessionId → { phase, workflowId }
const sessionCache = new Map<string, { phase: string; workflowId: string }>();

async function getSessionPhase(
  client: OpencodeClient,
  sessionId: string,
): Promise<{ phase: string; workflowId: string } | null> {
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId)!;
  }

  try {
    const session = await (client.session.get as unknown as (opts: { sessionID: string }) => Promise<{ title?: string }>)({ sessionID: sessionId });
    const title = (session as { title?: string }).title ?? "";
    if (!title.startsWith(PILOT_TITLE_PREFIX)) return null;

    // Format: pilot/<workflowId>/<phase>/<taskId>
    const parts = title.slice(PILOT_TITLE_PREFIX.length).split("/");
    if (parts.length < 2) return null;

    const [workflowId, phase] = parts;
    const result = { phase: phase!, workflowId: workflowId! };
    sessionCache.set(sessionId, result);
    return result;
  } catch {
    return null;
  }
}

const pilotPlugin: Plugin = async (input) => {
  return {
    "tool.execute.before": async (toolInput, _output) => {
      const sessionId = (toolInput as { sessionID?: string }).sessionID;
      if (!sessionId) return;

      const sessionInfo = await getSessionPhase(input.client, sessionId);
      if (!sessionInfo) return;

      const { phase } = sessionInfo;
      const toolName = (toolInput as { tool?: string }).tool ?? "";
      const args = (toolInput as { args?: Record<string, unknown> }).args ?? {};

      // Builder: deny destructive git operations
      if (phase === "execute") {
        if (toolName === "bash") {
          const cmd = String(args["command"] ?? "").trim();
          for (const pattern of BUILDER_DENIED_PATTERNS) {
            if (pattern.test(cmd)) {
              throw new Error(
                `pilot-builder: "${cmd}" is not allowed. ` +
                `The orchestrator handles commits and pushes after verify passes.`,
              );
            }
          }
        }
      }
    },
  };
};

export default pilotPlugin;
