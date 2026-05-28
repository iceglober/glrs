// telemetry sub-plugin — hooks tool.execute.before/after and session events
// to emit anonymous usage telemetry via Aptabase.
//
// Follows the sub-plugin pattern established by cost-tracker.ts.
// Composed in src/index.ts alongside other sub-plugins.
//
// Duration tracking uses a Map<callID, startTime> instead of mutating
// output.args — avoids conflicts with other tool.execute.before hooks.
//
// Env var: HARNESS_OPENCODE_TELEMETRY=0 disables entirely (returns {}).

import type { Plugin } from "@opencode-ai/plugin";
import { extname } from "node:path";
import { track, DISABLED } from "../telemetry.js";

const plugin: Plugin = async () => {
  if (DISABLED) {
    return {};
  }

  track("plugin.loaded");

  const sessionStart = Date.now();
  let toolCalls = 0;

  // Map<callID, startTime> for duration tracking. Entries are created in
  // tool.execute.before and consumed+deleted in tool.execute.after.
  // Stale entries (before without matching after — e.g. tool aborted by
  // tool denial) leak a few bytes per orphan. Acceptable for
  // process-lifetime maps with short-lived string keys.
  const callTimings = new Map<string, number>();

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      _output: { args: any },
    ) => {
      callTimings.set(input.callID, Date.now());
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any },
    ) => {
      toolCalls++;

      const t0 = callTimings.get(input.callID);
      callTimings.delete(input.callID);
      const duration_ms = t0 ? Date.now() - t0 : 0;

      // Determine failure from output. tool.execute.after's `output.output`
      // contains the tool's result string. A failed tool typically has error
      // indicators in metadata or non-zero exit codes.
      const outStr = String(output.output ?? "");
      const failed =
        output.metadata?.error != null ||
        (output.metadata?.exitCode != null && output.metadata.exitCode !== 0);
      const outcome = failed ? "error" : "success";

      if (input.tool === "hashline_edit") {
        const filePath = String(input.args?.target_filepath ?? "");
        const ext = extname(filePath);
        const isHashMismatch = /hash.*mismatch|stale/i.test(outStr);
        const isNotFound = /not.*found/i.test(outStr);

        track("hashline.edit", {
          outcome,
          duration_ms,
          ext,
          stale: isHashMismatch,
          error_class: failed
            ? isHashMismatch
              ? "hash_mismatch"
              : isNotFound
                ? "file_not_found"
                : "other"
            : undefined,
        });
      } else if (input.tool?.startsWith("serena_")) {
        track("serena.call", {
          tool: input.tool.replace("serena_", ""),
          duration_ms,
          outcome,
        });
      } else if (input.tool?.startsWith("memory_")) {
        track("memory.call", {
          memory_op: input.tool.replace("memory_", ""),
          duration_ms,
          outcome,
        });
      } else {
        // All other tools — our custom tools (ast_grep, tsc_check, etc.)
        // and any MCP/builtin tools that flow through the hooks.
        track("tool.call", {
          tool: input.tool,
          duration_ms,
          outcome,
        });
      }
    },

    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      if (event.type === "session.idle") {
        track("session.ended", {
          duration_ms: Date.now() - sessionStart,
          ops_count: toolCalls,
        });
        return;
      }

      if (event.type === "message.updated") {
        const info = event.properties?.info as {
          role?: string;
          modelID?: string;
          providerID?: string;
          tokens?: { output?: number };
          time?: { created?: number; completed?: number | null };
        } | undefined;
        if (!info || info.role !== "assistant") return;
        if (info.time?.completed == null) return;

        const outputTokens = info.tokens?.output ?? 0;
        const durationS = (info.time.completed - (info.time.created ?? 0)) / 1000;
        if (outputTokens <= 0 || durationS <= 0) return;

        track("model.token_speed", {
          model: info.modelID ?? "unknown",
          provider: info.providerID ?? "unknown",
          output_tokens: outputTokens,
          duration_ms: Math.round(durationS * 1000),
          tps: Math.round((outputTokens / durationS) * 10) / 10,
        });
      }
    },
  };
};

export default plugin;
