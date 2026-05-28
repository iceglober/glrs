/**
 * parallel-dispatch — sisyphus-style enforcement for parallel subagent dispatch.
 *
 * A tool.execute.after hook that fires on every `task` tool call. Tracks
 * all subagent dispatches (not just @build) and nudges PRIME toward
 * batching independent work in parallel.
 *
 * Three enforcement layers (matching the oh-my-openagent pattern):
 *   1. Prompt framing (in prime.md) — "you are an orchestrator first"
 *   2. This hook — post-hoc correction on sequential dispatch
 *   3. Continuation pressure — autopilot loop re-invokes if incomplete
 */

import type { Plugin } from "@opencode-ai/plugin";
import { track } from "../telemetry.js";

const BUILD_PARALLEL_GUIDANCE = [
  "",
  "[PARALLEL DISPATCH REMINDER]",
  "You just dispatched a single @build. If the plan has 2+ independent",
  "phases with disjoint file sets, you MUST dispatch ALL of them in your",
  "NEXT response — one task() call per phase, ALL in the same message.",
  "Sequential dispatch wastes wall time. Parallel is the default.",
].join("\n");

const GENERAL_PARALLEL_GUIDANCE = [
  "",
  "[DELEGATION REMINDER]",
  "You just dispatched a single subagent. Check: is there other independent",
  "work (search, exploration, verification) you could have dispatched in",
  "the SAME message? Batch independent subagent calls in one turn.",
  "Orchestrate — don't serialize.",
].join("\n");

interface DispatchState {
  buildCount: number;
  totalTaskCount: number;
  lastDispatchTs: number;
}

const sessions = new Map<string, DispatchState>();

function getState(sessionId: string): DispatchState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { buildCount: 0, totalTaskCount: 0, lastDispatchTs: 0 };
    sessions.set(sessionId, s);
  }
  return s;
}

function isTaskCall(tool: string): boolean {
  return tool === "task";
}

function isTaskBuild(args: unknown): boolean {
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

function flushBatch(state: DispatchState): void {
  if (state.buildCount === 1) {
    track("subagent.dispatch.serial", { ops_count: 1, agent: "build" });
  } else if (state.buildCount > 1) {
    track("subagent.dispatch.parallel", { ops_count: state.buildCount, agent: "build" });
  }
  if (state.totalTaskCount === 1) {
    track("subagent.dispatch.serial.any", { ops_count: 1 });
  } else if (state.totalTaskCount > 1) {
    track("subagent.dispatch.parallel.any", { ops_count: state.totalTaskCount });
  }
  state.buildCount = 0;
  state.totalTaskCount = 0;
}

const plugin: Plugin = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      if (!isTaskCall(input.tool)) return;

      const state = getState(input.sessionID);
      const now = Date.now();
      if (now - state.lastDispatchTs > 5000) {
        flushBatch(state);
      }
      state.totalTaskCount++;
      state.lastDispatchTs = now;

      const isBuild = isTaskBuild(input.args);
      if (isBuild) {
        state.buildCount++;
      }

      if (state.totalTaskCount === 1) {
        output.output += isBuild
          ? BUILD_PARALLEL_GUIDANCE
          : GENERAL_PARALLEL_GUIDANCE;
      }
    },

    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type === "session.idle") {
        for (const state of sessions.values()) {
          flushBatch(state);
        }
        sessions.clear();
      }
    },
  };
};

export default plugin;
