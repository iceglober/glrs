/**
 * dispatch-tracker — observes which subagent is dispatched on each task call.
 *
 * Foundation for measuring cost-cascading effectiveness. The parallel-dispatch
 * plugin already tracks dispatch counts; this plugin adds per-agent visibility:
 * we want to know whether @build-cheap is succeeding or constantly escalating
 * to @build / @build-deep.
 *
 * Emits one `subagent.dispatch` event per task tool call with the agent name.
 * Combined with `model.token_speed` and `tool.call` outcome events, this gives
 * us the data to tune cascading thresholds empirically.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { track } from "../telemetry.js";

function extractAgentName(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const a = args as Record<string, unknown>;
  // OpenCode's task tool uses `subagent_type` per the binary inspection.
  // We also check `agent`/`agentName` defensively for older shapes.
  const direct =
    (a.subagent_type as string | undefined) ??
    (a.agent as string | undefined) ??
    (a.agentName as string | undefined);
  if (direct && typeof direct === "string") return direct.replace(/^@/, "");
  // Fall back to parsing @agent-name from the prompt's first line
  const prompt = (a.prompt ?? a.message ?? a.content ?? "") as string;
  const match = /(?:^|\s)@([\w-]+)\b/.exec(prompt);
  return match ? match[1] : undefined;
}

function tierFromAgentName(agent: string): string | undefined {
  if (agent.endsWith("-cheap")) return "cheap";
  if (agent.endsWith("-deep") || agent.endsWith("-thorough")) return "deep";
  // Known mid-execute agents
  if (
    agent === "build" ||
    agent === "spec-reviewer" ||
    agent === "code-reviewer"
  ) {
    return "mid-execute";
  }
  // Known fast agents
  if (agent === "code-searcher") return "fast";
  // Default: don't guess
  return undefined;
}

const plugin: Plugin = async () => {
  return {
    "tool.execute.after": async (input) => {
      if (input.tool !== "task") return;
      const agent = extractAgentName(input.args);
      if (!agent) return;
      const tier = tierFromAgentName(agent);
      track("subagent.dispatch", {
        subagent: agent,
        ...(tier ? { tier } : {}),
      });
    },
  };
};

export default plugin;
