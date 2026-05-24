/**
 * Tests for CLI flag override application.
 *
 * Verifies that CLI flags correctly override config fields with proper
 * precedence and immutability.
 */

import { describe, it, expect } from "bun:test";
import { applyCLIOverrides, type CLIFlags } from "../src/config-reader.js";

/**
 * Deep clone utility for testing immutability.
 */
function deepClone(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item));
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  const cloned: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone((obj as Record<string, unknown>)[key]);
    }
  }
  return cloned;
}

/**
 * Deep equality check for testing (handles undefined fields properly).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null && b === null) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) => deepEqual(
    (a as Record<string, unknown>)[key],
    (b as Record<string, unknown>)[key],
  ));
}

describe("applyCLIOverrides", () => {
  const baseConfig = {
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
    notify_url: undefined,
    notify_events: undefined,
    adapters: {
      opencode: {
        agents: {},
      },
      claude_code_cli: {
        skip_permissions: true,
        allowed_tools: [],
      },
    },
  };

  it("returns input unchanged when all flags are undefined", () => {
    const cloned = deepClone(baseConfig);
    const result = applyCLIOverrides(baseConfig, {});
    expect(deepEqual(result, baseConfig)).toBe(true);
  });

  it("--adapter overrides config.adapter", () => {
    const result = applyCLIOverrides(baseConfig, {
      adapter: "claude-code-cli",
    }) as Record<string, unknown>;
    expect(result.adapter).toBe("claude-code-cli");
  });


  it("--parallel N sets execution_order and parallel_lanes", () => {
    const result = applyCLIOverrides(baseConfig, {
      parallel: 4,
    }) as Record<string, unknown>;
    expect(result.execution_order).toBe("parallel");
    expect(result.parallel_lanes).toBe(4);
  });

  it("--ship sets auto_ship to true", () => {
    const result = applyCLIOverrides(baseConfig, {
      ship: true,
    }) as Record<string, unknown>;
    expect(result.auto_ship).toBe(true);
  });

  it("--resume sets checkpoint to true", () => {
    const result = applyCLIOverrides(baseConfig, {
      resume: true,
    }) as Record<string, unknown>;
    expect(result.checkpoint).toBe(true);
  });

  it("--max-iterations-per-phase N sets max_iterations_per_phase", () => {
    const result = applyCLIOverrides(baseConfig, {
      maxIterationsPerPhase: 3,
    }) as Record<string, unknown>;
    expect(result.max_iterations_per_phase).toBe(3);
  });

  it("--stall-timeout N sets stall_timeout", () => {
    const result = applyCLIOverrides(baseConfig, {
      stallTimeout: 600000,
    }) as Record<string, unknown>;
    expect(result.stall_timeout).toBe(600000);
  });

  it("--notify URL sets notify_url", () => {
    const result = applyCLIOverrides(baseConfig, {
      notify: "https://example.com/webhook",
    }) as Record<string, unknown>;
    expect(result.notify_url).toBe("https://example.com/webhook");
  });

  it("does not mutate the input config", () => {
    const cloned = deepClone(baseConfig);
    const flags: CLIFlags = {
      adapter: "claude-code-cli",
      parallel: 2,
      ship: true,
      notify: "https://example.com/webhook",
    };
    applyCLIOverrides(baseConfig, flags);
    expect(deepEqual(baseConfig, cloned)).toBe(true);
  });

  it("applies multiple flags correctly", () => {
    const result = applyCLIOverrides(baseConfig, {
      adapter: "claude-code-cli",
      parallel: 3,
      ship: true,
      maxIterationsPerPhase: 5,
      stallTimeout: 300000,
      notify: "https://example.com/webhook",
    }) as Record<string, unknown>;

    expect(result.adapter).toBe("claude-code-cli");
    expect(result.execution_order).toBe("parallel");
    expect(result.parallel_lanes).toBe(3);
    expect(result.auto_ship).toBe(true);
    expect(result.max_iterations_per_phase).toBe(5);
    expect(result.stall_timeout).toBe(300000);
    expect(result.notify_url).toBe("https://example.com/webhook");
  });

  it("preserves config fields not affected by flags", () => {
    const configWithExtra = {
      ...baseConfig,
      verify: "after_phase",
      verify_timeout: 120000,
      custom_field: "custom_value",
    };
    const result = applyCLIOverrides(configWithExtra, {
      parallel: 2,
    }) as Record<string, unknown>;
    expect((result as Record<string, unknown>).verify).toBe("after_phase");
    expect((result as Record<string, unknown>).verify_timeout).toBe(120000);
    expect((result as Record<string, unknown>).custom_field).toBe("custom_value");
  });
});
