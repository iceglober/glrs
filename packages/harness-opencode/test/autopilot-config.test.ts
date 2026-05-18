/**
 * Type-level tests for AutopilotConfig.
 *
 * These tests verify TypeScript compilation constraints:
 *   (a) All AutopilotConfig fields are optional
 *   (b) adapter is a string-literal union "opencode" | "claude-code-cli"
 *   (c) Discriminated adapters namespace compiles correctly
 */

import { describe, it, expect } from "bun:test";
import type {
  AutopilotConfig,
  AgentOverride,
  PhaseConfig,
} from "../src/autopilot/autopilot-config.js";
import { DEFAULT_AUTOPILOT_CONFIG } from "../src/autopilot/autopilot-config.js";

describe("AutopilotConfig type-level tests", () => {
  // Test (a): All fields are optional — empty object should be valid AutopilotConfig
  it("accepts an empty object as valid AutopilotConfig", () => {
    const empty: AutopilotConfig = {};
    expect(empty).toEqual({});
  });

  // Test (a): Individual optional fields
  it("accepts partial configurations with single fields", () => {
    const onlyAdapter: AutopilotConfig = { adapter: "opencode" };
    expect(onlyAdapter.adapter).toBe("opencode");

    const onlyModels: AutopilotConfig = { models: { enrichment: "deep" } };
    expect(onlyModels.models?.enrichment).toBe("deep");

    const onlyHooks: AutopilotConfig = { hooks: { after_plan: "echo done" } };
    expect(onlyHooks.hooks?.after_plan).toBe("echo done");
  });

  // Test (b): adapter field is a string-literal union
  it("accepts adapter as 'opencode' or 'claude-code-cli'", () => {
    const config1: AutopilotConfig = { adapter: "opencode" };
    expect(config1.adapter).toBe("opencode");

    const config2: AutopilotConfig = { adapter: "claude-code-cli" };
    expect(config2.adapter).toBe("claude-code-cli");
  });

  // Test (c): models field accepts all optional sub-fields
  it("accepts optional model fields", () => {
    const withAll: AutopilotConfig = {
      models: {
        enrichment: "deep",
        execution: "autopilot-execute",
        debrief: "mid",
      },
    };
    expect(withAll.models?.enrichment).toBe("deep");
    expect(withAll.models?.execution).toBe("autopilot-execute");
    expect(withAll.models?.debrief).toBe("mid");

    const withOne: AutopilotConfig = { models: { enrichment: "custom" } };
    expect(withOne.models?.enrichment).toBe("custom");
  });

  // Test (c): agents as Record<string, AgentOverride>
  it("accepts agents as a record of agent overrides", () => {
    const config: AutopilotConfig = {
      agents: {
        build: { model: "custom-model" },
        review: { timeout: 5000 },
      },
    };
    expect(config.agents?.build).toBeDefined();
    expect((config.agents?.build as Record<string, unknown>)?.model).toBe(
      "custom-model",
    );
  });

  // Test (c): hooks as Record<string, string | string[]>
  it("accepts hooks as strings or arrays of strings", () => {
    const config: AutopilotConfig = {
      hooks: {
        single: "echo hello",
        multiple: ["echo 1", "echo 2"],
        mixed: "just a string",
      },
    };
    expect(config.hooks?.single).toBe("echo hello");
    expect(Array.isArray(config.hooks?.multiple)).toBe(true);
  });

  // Test (c): Discriminated adapters namespace
  it("accepts opencode adapter configuration", () => {
    const config: AutopilotConfig = {
      adapters: {
        opencode: {
          agents: {
            build: { model: "deep" },
          },
        },
      },
    };
    expect(config.adapters?.opencode?.agents?.build).toBeDefined();
  });

  it("accepts claude-code-cli adapter configuration", () => {
    const config: AutopilotConfig = {
      adapters: {
        claude_code_cli: {
          skip_permissions: false,
          allowed_tools: ["bash", "read"],
        },
      },
    };
    expect(config.adapters?.claude_code_cli?.skip_permissions).toBe(false);
    expect(config.adapters?.claude_code_cli?.allowed_tools).toEqual([
      "bash",
      "read",
    ]);
  });

  it("accepts both adapter configs simultaneously", () => {
    const config: AutopilotConfig = {
      adapters: {
        opencode: { agents: {} },
        claude_code_cli: { skip_permissions: true, allowed_tools: [] },
      },
    };
    expect(config.adapters?.opencode?.agents).toBeDefined();
    expect(config.adapters?.claude_code_cli?.skip_permissions).toBe(true);
  });

  // Test enrichment and execution configs
  it("accepts enrichment and execution phase configs", () => {
    const config: AutopilotConfig = {
      enrichment: { timeout: 60000 },
      execution: { maxRetries: 3 },
    };
    expect((config.enrichment as Record<string, unknown>)?.timeout).toBe(60000);
    expect((config.execution as Record<string, unknown>)?.maxRetries).toBe(3);
  });

  // Test phases configuration
  it("accepts phases configuration", () => {
    const config: AutopilotConfig = {
      phases: {
        wave_0: { parallel: true },
        wave_1: { timeout: 120000 },
      },
    };
    expect(config.phases?.wave_0).toBeDefined();
    expect(config.phases?.wave_1).toBeDefined();
  });

  // Runtime test: DEFAULT_AUTOPILOT_CONFIG is a valid AutopilotConfig
  it("DEFAULT_AUTOPILOT_CONFIG has the expected structure", () => {
    expect(DEFAULT_AUTOPILOT_CONFIG.adapter).toBe("opencode");
    expect(DEFAULT_AUTOPILOT_CONFIG.models?.enrichment).toBe("deep");
    expect(DEFAULT_AUTOPILOT_CONFIG.models?.execution).toBe("autopilot-execute");
    expect(DEFAULT_AUTOPILOT_CONFIG.models?.debrief).toBe("deep");
    expect(DEFAULT_AUTOPILOT_CONFIG.agents).toEqual({});
    expect(DEFAULT_AUTOPILOT_CONFIG.enrichment).toEqual({});
    expect(DEFAULT_AUTOPILOT_CONFIG.execution).toEqual({});
    expect(DEFAULT_AUTOPILOT_CONFIG.hooks).toEqual({});
    expect(DEFAULT_AUTOPILOT_CONFIG.phases).toEqual({});
    expect(DEFAULT_AUTOPILOT_CONFIG.adapters?.opencode?.agents).toEqual({});
    expect(
      DEFAULT_AUTOPILOT_CONFIG.adapters?.claude_code_cli?.skip_permissions,
    ).toBe(true);
    expect(
      DEFAULT_AUTOPILOT_CONFIG.adapters?.claude_code_cli?.allowed_tools,
    ).toEqual([]);
  });

  // Type exports are accessible
  it("exports AgentOverride and PhaseConfig types", () => {
    const agent: AgentOverride = { model: "test" };
    expect(agent.model).toBe("test");

    const phase: PhaseConfig = { timeout: 5000 };
    expect((phase as Record<string, unknown>).timeout).toBe(5000);
  });
});
