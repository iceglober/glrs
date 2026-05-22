import { describe, it, expect } from "bun:test";
import {
  validateConfig,
  type AutopilotConfig,
  type ValidationResult,
  ALLOWED_ADAPTERS,
  ALLOWED_VERIFY_STRATEGIES,
  ALLOWED_EXECUTION_ORDERS,
  ALLOWED_ROLLBACK_STRATEGIES,
  ALLOWED_CHANGESET_BUMPS,
} from "../src/autopilot/config-reader.js";

function collectErrorPaths(result: ValidationResult): string[] {
  if (result.ok) return [];
  return result.errors.map((e) => e.path).sort();
}

describe("validateConfig", () => {
  it("empty config (all defaults) is ok: true", () => {
    const config: AutopilotConfig = {};
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("adapter typo records a path/message error", () => {
    const config: AutopilotConfig = { adapter: "claude" as any };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      const adapterError = result.errors.find((e) => e.path === "adapter");
      expect(adapterError).toBeDefined();
      expect(adapterError?.message).toContain('got "claude"');
    }
  });

  it("verify: 'after_item' is valid", () => {
    const config: AutopilotConfig = { verify: "after_item" };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("verify_timeout: -1 records error", () => {
    const config: AutopilotConfig = { verify_timeout: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "verify_timeout");
      expect(error).toBeDefined();
      expect(error?.message).toContain("positive integer");
    }
  });

  it("multiple invalid fields produce multiple errors", () => {
    const config: AutopilotConfig = {
      adapter: "invalid" as any,
      verify: "bad_strategy" as any,
      verify_timeout: -100,
      execution_order: "concurrent" as any,
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(4);
      const paths = collectErrorPaths(result);
      expect(paths).toContain("adapter");
      expect(paths).toContain("verify");
      expect(paths).toContain("verify_timeout");
      expect(paths).toContain("execution_order");
    }
  });

  it("invalid field inside phases.wave_0.verify records error with correct path", () => {
    const config: AutopilotConfig = {
      phases: {
        wave_0: {
          verify: "invalid_strategy" as any,
        },
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "phases.wave_0.verify");
      expect(error).toBeDefined();
    }
  });

  it("hooks.pre_phase: '' records an error (empty hook command is invalid)", () => {
    const config: AutopilotConfig = {
      hooks: {
        pre_phase: "",
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "hooks.pre_phase");
      expect(error).toBeDefined();
      expect(error?.message).toContain("non-empty");
    }
  });

  it("log_level: 'verbose' records error (not a pino level)", () => {
    const config: AutopilotConfig = {
      log_level: "verbose" as any,
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "log_level");
      expect(error).toBeDefined();
      expect(error?.message).toContain("pino level");
    }
  });

  it("valid pino levels are accepted", () => {
    const levels = ["fatal", "error", "warn", "info", "debug", "trace"];
    for (const level of levels) {
      const config: AutopilotConfig = { log_level: level };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
    }
  });

  it("max_iterations_per_phase: 0 records error (must be positive)", () => {
    const config: AutopilotConfig = { max_iterations_per_phase: 0 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "max_iterations_per_phase");
      expect(error).toBeDefined();
      expect(error?.message).toContain("positive integer");
    }
  });

  it("max_iterations_per_phase: 1.5 records error (must be integer)", () => {
    const config: AutopilotConfig = { max_iterations_per_phase: 1.5 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "max_iterations_per_phase");
      expect(error).toBeDefined();
    }
  });

  it("execution_order: 'parallel' is valid", () => {
    const config: AutopilotConfig = { execution_order: "parallel" };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("parallel_lanes: 4 is valid", () => {
    const config: AutopilotConfig = { parallel_lanes: 4 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("rollback_on_failure: 'off' is valid", () => {
    const config: AutopilotConfig = { rollback_on_failure: "off" };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("changeset_bump: 'minor' is valid", () => {
    const config: AutopilotConfig = { changeset_bump: "minor" };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("stall_timeout: 30000 is valid", () => {
    const config: AutopilotConfig = { stall_timeout: 30000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("hooks can be string or array of strings", () => {
    const config: AutopilotConfig = {
      hooks: {
        pre_phase: "echo 'start'",
        post_phase: ["echo 'end'", "echo 'done'"],
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("empty hook in array records error", () => {
    const config: AutopilotConfig = {
      hooks: {
        post_phase: ["echo 'first'", "", "echo 'last'"],
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "hooks.post_phase[1]");
      expect(error).toBeDefined();
    }
  });

  it("phase-level verify_timeout overrides work independently", () => {
    const config: AutopilotConfig = {
      verify_timeout: 100,
      phases: {
        wave_0: {
          verify_timeout: -1,
        },
        wave_1: {
          verify_timeout: 200,
        },
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "phases.wave_0.verify_timeout");
      expect(error).toBeDefined();
      // wave_1 should not have an error
      const wave1Error = result.errors.find((e) => e.path === "phases.wave_1.verify_timeout");
      expect(wave1Error).toBeUndefined();
    }
  });

  it("whitespace-only hook is treated as empty", () => {
    const config: AutopilotConfig = {
      hooks: {
        pre_phase: "   \t  ",
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((e) => e.path === "hooks.pre_phase");
      expect(error).toBeDefined();
    }
  });

  it("valid complete config passes", () => {
    const config: AutopilotConfig = {
      adapter: "opencode",
      models: {
        enrichment: "deep",
        execution: "autopilot-execute",
        debrief: "deep",
      },
      verify: "after_phase",
      verify_timeout: 300000,
      max_iterations_per_phase: 5,
      execution_order: "sequential",
      parallel_lanes: 1,
      rollback_on_failure: "soft",
      changeset_bump: "patch",
      log_level: "info",
      hooks: {
        pre_phase: "echo start",
      },
      phases: {
        wave_0: {
          verify: "after_item",
          verify_timeout: 600000,
        },
      },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });
});
