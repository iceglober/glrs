/**
 * AutopilotConfig — fully-typed TypeScript interface for autopilot behavior configuration.
 *
 * All fields are optional. Defaults are applied at resolution time via DEFAULT_AUTOPILOT_CONFIG.
 * The config supports three layers:
 *   1. DEFAULT_AUTOPILOT_CONFIG (built-in defaults)
 *   2. Project-level config (`.glrs/autopilot.yaml`)
 *   3. Plan-specific config (`.glrs/plans/<slug>/autopilot.yaml`)
 *
 * Resolution order: plan-specific (highest priority) > project > defaults (lowest priority).
 * Field-level merge — overrides apply to individual keys, not entire blocks.
 */

/** Per-agent configuration overrides. Agent-specific model and behavior settings. */
export type AgentOverride = Record<string, unknown>;

/** Configuration for a specific phase. Phase-specific settings and behavior. */
export type PhaseConfig = Record<string, unknown>;

/**
 * AutopilotConfig — the complete configuration shape for autopilot behavior.
 */
export interface AutopilotConfig {
  /**
   * Adapter that drives the agent.
   * @default "opencode"
   */
  adapter?: "opencode" | "claude-code-cli";

  /**
   * Model tiers or full model IDs for each phase.
   * Interpretation is delegated to the active adapter's resolver.
   */
  models?: {
    /**
     * Model for the enrichment phase.
     * @default "deep" (OpenCode tier) or "claude-opus-4-7" (claude-code-cli)
     */
    enrichment?: string;

    /**
     * Model for the execution phase.
     * @default "autopilot-execute" (OpenCode tier) or "claude-haiku-4-5-20251001" (claude-code-cli)
     */
    execution?: string;

    /**
     * Model for the debrief phase.
     * @default "deep" (OpenCode tier) or "claude-opus-4-7" (claude-code-cli)
     */
    debrief?: string;
  };

  /**
   * Per-agent configuration overrides (global scope, not adapter-specific).
   * Maps agent names to their override configurations.
   * @default {}
   */
  agents?: Record<string, AgentOverride>;

  /**
   * Enrichment phase configuration.
   * Contains phase-specific settings and behavior.
   * @default {}
   */
  enrichment?: Record<string, unknown>;

  /**
   * Execution phase configuration.
   * Contains phase-specific settings and behavior.
   * @default {}
   */
  execution?: Record<string, unknown>;

  /**
   * Hooks configuration.
   * Maps hook names to shell commands or arrays of commands.
   * @default {}
   */
  hooks?: Record<string, string | string[]>;

  /**
   * Phases configuration.
   * Maps phase names to their configuration objects.
   * @default {}
   */
  phases?: Record<string, PhaseConfig>;

  /**
   * Webhook URL to POST lifecycle events to (optional).
   * Supports plain webhooks and Slack incoming webhooks (auto-detected).
   * CLI --notify flag overrides this setting when both are provided.
   * @default undefined
   */
  notify_url?: string;

  /**
   * Webhook event types to send (optional).
   * When empty or undefined, all events are sent.
   * Valid event types: "iteration_complete", "phase_complete", "run_complete", "error", "struggle", "stall".
   * CLI flag overrides this setting when both are provided.
   * @default undefined (send all events)
   */
  notify_events?: Array<"iteration_complete" | "phase_complete" | "run_complete" | "error" | "struggle" | "stall">;

  /**
   * Per-phase iteration budget override.
   * CLI --max-iterations-per-phase flag maps to this field.
   * @default varies by tier (see MAX_ITERATIONS_PER_PHASE_BY_TIER)
   */
  max_iterations_per_phase?: number;

  /**
   * Per-iteration stall timeout in milliseconds.
   * CLI --stall-timeout flag maps to this field.
   * @default varies by tier (see STALL_MS_BY_TIER)
   */
  stall_timeout?: number;

  /**
   * Execution order for phases.
   * CLI --parallel flag sets this to "parallel".
   * @default "sequential"
   */
  execution_order?: "sequential" | "parallel";

  /**
   * Number of parallel lanes for phase execution.
   * CLI --parallel N sets this field.
   * @default 1
   */
  parallel_lanes?: number;

  /**
   * Auto-ship after all phases complete.
   * CLI --ship flag maps to this field.
   * @default undefined (require manual /ship)
   */
  auto_ship?: boolean;

  /**
   * Resume from checkpoint.
   * CLI --resume flag maps to this field.
   * @default undefined
   */
  checkpoint?: boolean;

  /**
   * Adapter-specific configuration.
   * Discriminated by the active adapter — only the matching adapter's config is read at runtime.
   * Unknown adapter-specific keys are silently ignored.
   */
  adapters?: {
    /**
     * OpenCode adapter configuration.
     * Read only when `adapter === "opencode"`.
     */
    opencode?: {
      /**
       * Per-agent overrides for the OpenCode adapter.
       * Maps agent names to their OpenCode-specific configurations.
       * @default {}
       */
      agents?: Record<string, AgentOverride>;
    };

    /**
     * Claude Code CLI adapter configuration.
     * Read only when `adapter === "claude-code-cli"`.
     */
    claude_code_cli?: {
      /**
       * Whether to skip permission prompts for the Claude Code CLI adapter.
       * @default true
       */
      skip_permissions?: boolean;

      /**
       * List of tools allowed for the Claude Code CLI adapter.
       * When populated, only these tools can be invoked; empty means all tools allowed.
       * @default []
       */
      allowed_tools?: string[];

      /**
       * Maximum number of turns for a single Claude Code CLI session.
       * @default undefined (no limit)
       */
      max_turns?: number;
    };
  };
}

/**
 * DEFAULT_AUTOPILOT_CONFIG — the built-in default configuration for autopilot.
 *
 * This is the lowest-priority layer in the three-layer merge:
 *   DEFAULT_AUTOPILOT_CONFIG < project-level config < plan-specific config
 *
 * All leaf fields are populated with sensible defaults. When resolving config,
 * defaults are merged first, then project config, then plan-specific config override them.
 */
export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  /** Default to OpenCode adapter. */
  adapter: "opencode",

  /** Default models — OpenCode tier names (interpreted by OpenCode adapter). */
  models: {
    enrichment: "deep",
    execution: "autopilot-execute",
    debrief: "deep",
  },

  /** No global agent overrides by default. */
  agents: {},

  /** No enrichment phase config by default. */
  enrichment: {},

  /** No execution phase config by default. */
  execution: {},

  /** No hooks by default. */
  hooks: {},

  /** No phase-specific config by default. */
  phases: {},

  /** No webhook notification by default. */
  notify_url: undefined,
  notify_events: undefined,

  /** Adapter-specific defaults for both adapters. */
  adapters: {
    /** OpenCode adapter — no agent overrides by default. */
    opencode: {
      agents: {},
    },

    /** Claude Code CLI adapter — skip permissions, allow all tools by default. */
    claude_code_cli: {
      skip_permissions: true,
      allowed_tools: [],
    },
  },
};
