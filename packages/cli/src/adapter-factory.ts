/**
 * Adapter factory — resolves an adapter name to an AgentAdapter instance.
 *
 * Used by autopilot, loop, and TUI commands. Reads the resolved AutopilotConfig
 * to configure adapter-specific settings (models, permissions, etc).
 */

import type { AgentAdapter } from "@glrs-dev/autopilot";
import type { AutopilotConfig } from "./autopilot/autopilot-config.js";

export const ADAPTER_NAMES = ["opencode", "claude-code-cli"] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];
export const DEFAULT_ADAPTER: AdapterName = "opencode";

export async function createAdapter(name: AdapterName, config?: AutopilotConfig): Promise<AgentAdapter> {
  const resolvedConfig = config || {
    adapter: "opencode",
    models: {
      enrichment: "deep",
      execution: "autopilot-execute",
      debrief: "deep",
    },
    agents: {},
    enrichment: {},
    execution: {},
    hooks: {},
    phases: {},
    adapters: {
      opencode: { agents: {} },
      claude_code_cli: { skip_permissions: true, allowed_tools: [] },
    },
  };

  const adapter = resolvedConfig.adapter || "opencode";

  switch (adapter) {
    case "opencode": {
      const { OpenCodeAdapter } = await import("@glrs-dev/adapter-opencode");
      return new OpenCodeAdapter();
    }
    case "claude-code-cli": {
      const { ClaudeCodeCliAdapter } = await import("@glrs-dev/adapter-claude-code");
      const cliConfig = resolvedConfig.adapters?.claude_code_cli || {};
      return new ClaudeCodeCliAdapter({
        dangerouslySkipPermissions: cliConfig.skip_permissions ?? true,
        models: {
          enrich: resolvedConfig.models?.enrichment || "claude-opus-4-7",
          execute: resolvedConfig.models?.execution || "claude-haiku-4-5-20251001",
        },
        ...(cliConfig.allowed_tools ? { allowedTools: cliConfig.allowed_tools } : {}),
        ...(cliConfig.max_turns != null ? { maxTurns: cliConfig.max_turns } : {}),
      });
    }
    default:
      throw new Error(
        `Unknown adapter: ${adapter}. Available: ${ADAPTER_NAMES.join(", ")}`,
      );
  }
}
