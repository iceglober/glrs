/**
 * parallel-dispatch — sisyphus-style enforcement for parallel @build dispatch.
 *
 * A tool.execute.after hook that fires on every `task` tool call. When
 * PRIME dispatches a single @build for a plan with multiple independent
 * phases, it appends guidance to the tool output reminding PRIME to
 * dispatch remaining phases in parallel.
 *
 * Three enforcement layers (matching the oh-my-openagent pattern):
 *   1. Prompt framing (in prime.md) — "you are an orchestrator"
 *   2. This hook — post-hoc correction on sequential dispatch
 *   3. Continuation pressure — autopilot loop re-invokes if incomplete
 */

import type { Plugin } from "@opencode-ai/plugin";

const PARALLEL_GUIDANCE = [
  "",
  "[PARALLEL DISPATCH REMINDER]",
  "You just dispatched a single @build. If the plan has 2+ independent",
  "phases with disjoint file sets, you MUST dispatch ALL of them in your",
  "NEXT response — one task() call per phase, ALL in the same message.",
  "Sequential dispatch wastes wall time. Parallel is the default.",
].join("\n");

interface DispatchState {
  buildCount: number;
  lastDispatchTs: number;
}

const sessions = new Map<string, DispatchState>();

function getState(sessionId: string): DispatchState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { buildCount: 0, lastDispatchTs: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

function isTaskBuild(tool: string, args: unknown): boolean {
  if (tool !== "task") return false;
  if (typeof args !== "object" || args === null) return false;
  const a = args as Record<string, unknown>;
  const prompt = (a.prompt ?? a.message ?? a.content ?? "") as string;
  const agent = (a.agent ?? a.agentName ?? "") as string;
  return (
    agent === "build" ||
    agent === "@build" ||
    /(?:^|\s)@build\b/i.test(prompt)
  );
}

const plugin: Plugin = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      if (!isTaskBuild(input.tool, input.args)) return;

      const state = getState(input.sessionID);
      const now = Date.now();
      // Reset batch counter if >5s since last dispatch (new model response)
      if (now - state.lastDispatchTs > 5000) {
        state.buildCount = 0;
      }
      state.buildCount++;
      state.lastDispatchTs = now;

      // If this is the only @build in the current batch, inject guidance
      // (the model made a single task call instead of batching)
      if (state.buildCount === 1) {
        output.output += PARALLEL_GUIDANCE;
      }
    },
  };
};

export default plugin;
