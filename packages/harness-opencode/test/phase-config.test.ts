/**
 * Tests for resolvePhaseConfig
 *
 * Covers per-phase config resolution:
 *   - No phases block returns base unchanged
 *   - Deep merge of phase overrides
 *   - Nested field overrides (models, hooks, agents)
 *   - Extension stripping for .md and .yaml phase files
 */

import { describe, it, expect } from "bun:test";
import { resolvePhaseConfig } from "../src/autopilot/config-reader.js";
import type { AutopilotConfig } from "../src/autopilot/autopilot-config.js";

describe("resolvePhaseConfig", () => {
  describe("no phases block", () => {
    it("returns base unchanged when phases is undefined", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result).toBe(base);
    });

    it("returns base unchanged when phase name not found", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
        },
      };
      const result = resolvePhaseConfig(base, "wave_999");
      expect(result).toBe(base);
    });
  });

  describe("model overrides", () => {
    it("deep merges models.execution from phase", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: {
            models: { execution: "autopilot-execute" },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("autopilot-execute");
    });

    it("preserves base models when phase only overrides one field", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: {
          execution: "deep",
          enrichment: "deep",
          debrief: "deep",
        },
        phases: {
          wave_0: {
            models: { execution: "autopilot-execute" },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("autopilot-execute");
      expect(result.models?.enrichment).toBe("deep");
      expect(result.models?.debrief).toBe("deep");
    });

    it("completely replaces models if phase specifies full block", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: {
          execution: "deep",
          enrichment: "deep",
          debrief: "deep",
        },
        phases: {
          wave_0: {
            models: {
              execution: "autopilot-execute",
              enrichment: "mid",
              debrief: "mid",
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("autopilot-execute");
      expect(result.models?.enrichment).toBe("mid");
      expect(result.models?.debrief).toBe("mid");
    });
  });

  describe("hook overrides", () => {
    it("deep merges hooks from phase", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        hooks: {
          pre_phase: "echo before",
          post_phase: "echo after",
        },
        phases: {
          wave_0: {
            hooks: {
              post_phase: "cargo test",
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.hooks?.pre_phase).toBe("echo before");
      expect(result.hooks?.post_phase).toBe("cargo test");
    });

    it("adds new hooks when phase introduces them", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        hooks: {
          post_phase: "echo after",
        },
        phases: {
          wave_0: {
            hooks: {
              pre_phase: "echo before",
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.hooks?.pre_phase).toBe("echo before");
      expect(result.hooks?.post_phase).toBe("echo after");
    });
  });

  describe("agent overrides", () => {
    it("deep merges agents from phase", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        agents: {
          build: { model: "deep" },
          review: { timeout: 5000 },
        },
        phases: {
          wave_0: {
            agents: {
              build: { model: "mid" },
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.agents?.build?.model).toBe("mid");
      expect(result.agents?.review?.timeout).toBe(5000);
    });

    it("merges nested agent properties recursively", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        agents: {
          build: { model: "deep", priority: "high" },
        },
        phases: {
          wave_0: {
            agents: {
              build: { model: "mid" },
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.agents?.build?.model).toBe("mid");
      expect(result.agents?.build?.priority).toBe("high");
    });

    it("merges adapters.opencode.agents", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        adapters: {
          opencode: {
            agents: {
              build: { model: "deep" },
              review: { timeout: 5000 },
            },
          },
        },
        phases: {
          wave_0: {
            adapters: {
              opencode: {
                agents: {
                  build: { model: "mid" },
                },
              },
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.adapters?.opencode?.agents?.build?.model).toBe("mid");
      expect(result.adapters?.opencode?.agents?.review?.timeout).toBe(5000);
    });
  });

  describe("complex merges", () => {
    it("merges multiple override types simultaneously", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        hooks: { post_phase: "echo base" },
        agents: { build: { model: "deep" } },
        phases: {
          wave_0: {
            models: { execution: "autopilot-execute" },
            hooks: { post_phase: "cargo test" },
            agents: { build: { model: "mid" } },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("autopilot-execute");
      expect(result.hooks?.post_phase).toBe("cargo test");
      expect(result.agents?.build?.model).toBe("mid");
    });

    it("preserves unrelated base config fields", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        max_iterations_per_phase: 10,
        verify: "after_phase",
        phases: {
          wave_0: {
            models: { execution: "autopilot-execute" },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("autopilot-execute");
      expect(result.max_iterations_per_phase).toBe(10);
      expect(result.verify).toBe("after_phase");
    });

    it("deep merges nested object hierarchies", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        adapters: {
          opencode: {
            agents: {
              build: { model: "deep", priority: "high", timeout: 300 },
            },
          },
        },
        phases: {
          wave_0: {
            adapters: {
              opencode: {
                agents: {
                  build: { model: "mid", timeout: 600 },
                },
              },
            },
          },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.adapters?.opencode?.agents?.build?.model).toBe("mid");
      expect(result.adapters?.opencode?.agents?.build?.priority).toBe("high");
      expect(result.adapters?.opencode?.agents?.build?.timeout).toBe(600);
    });
  });

  describe("phase name handling", () => {
    it("looks up phase by exact name", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("autopilot-execute");
    });

    it("does not strip extensions in phase lookup (caller must strip)", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
        },
      };
      const resultMd = resolvePhaseConfig(base, "wave_0.md");
      expect(resultMd.models?.execution).toBe("deep");

      const resultYaml = resolvePhaseConfig(base, "wave_0.yaml");
      expect(resultYaml.models?.execution).toBe("deep");
    });
  });

  describe("immutability", () => {
    it("does not mutate base config", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
        },
      };
      const original = JSON.stringify(base);
      resolvePhaseConfig(base, "wave_0");
      expect(JSON.stringify(base)).toBe(original);
    });

    it("returns a different object when merging occurs", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result).not.toBe(base);
      expect(result.models).not.toBe(base.models);
    });

    it("returns same object when no phase found", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result).toBe(base);
    });
  });

  describe("edge cases", () => {
    it("handles empty phases block", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        phases: {},
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result).toBe(base);
    });

    it("handles phase override with empty object", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: {},
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.models?.execution).toBe("deep");
    });

    it("handles multiple phases in config", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        models: { execution: "deep" },
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
          wave_1: { models: { execution: "mid" } },
        },
      };
      const result0 = resolvePhaseConfig(base, "wave_0");
      expect(result0.models?.execution).toBe("autopilot-execute");

      const result1 = resolvePhaseConfig(base, "wave_1");
      expect(result1.models?.execution).toBe("mid");
    });

    it("preserves adapter in merged result", () => {
      const base: AutopilotConfig = {
        adapter: "opencode",
        phases: {
          wave_0: { models: { execution: "autopilot-execute" } },
        },
      };
      const result = resolvePhaseConfig(base, "wave_0");
      expect(result.adapter).toBe("opencode");
    });
  });
});
