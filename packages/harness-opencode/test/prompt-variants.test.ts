/**
 * Tests for the tier-based prompt variant selection system.
 *
 * The harness supports four model tiers: deep, mid, mid-execute, fast.
 * Agents assigned to `mid-execute` get strict-executor prompts when that
 * tier is explicitly configured. When `mid-execute` is NOT configured,
 * those agents fall back to the `mid` tier model and use reasoning prompts.
 *
 * Covers:
 * 1. AGENT_TIERS — mid-execute assignments for build, qa-reviewer, pilot-builder.
 * 2. getStrictPrompt() / getReasoningPrompt() — prompt retrieval.
 * 3. resolveHarnessModels() — tier-based model + prompt resolution.
 * 4. Mid-execute fallback to mid when not configured.
 * 5. applyConfig() integration — end-to-end with user-wins precedence.
 */

import { describe, it, test, expect } from "bun:test";
import {
  createAgents,
  AGENT_TIERS,
  getStrictPrompt,
  getReasoningPrompt,
} from "../src/agents/index.js";
import { resolveHarnessModels, applyConfig } from "../src/config-hook.js";

// ---- AGENT_TIERS ----

describe("AGENT_TIERS", () => {
  it("assigns build to mid-execute tier", () => {
    expect(AGENT_TIERS["build"]).toBe("mid-execute");
  });

  it("assigns qa-reviewer to mid-execute tier", () => {
    expect(AGENT_TIERS["qa-reviewer"]).toBe("mid-execute");
  });

  it("assigns pilot-builder to mid-execute tier", () => {
    expect(AGENT_TIERS["pilot-builder"]).toBe("mid-execute");
  });

  it("assigns docs-maintainer to mid tier (not mid-execute)", () => {
    expect(AGENT_TIERS["docs-maintainer"]).toBe("mid");
  });

  it("assigns lib-reader to mid tier", () => {
    expect(AGENT_TIERS["lib-reader"]).toBe("mid");
  });

  it("assigns prime to deep tier", () => {
    expect(AGENT_TIERS["prime"]).toBe("deep");
  });

  it("assigns code-searcher to fast tier", () => {
    expect(AGENT_TIERS["code-searcher"]).toBe("fast");
  });
});

// ---- getStrictPrompt / getReasoningPrompt ----

describe("getStrictPrompt", () => {
  it("returns the strict-executor prompt for build", () => {
    const prompt = getStrictPrompt("build");
    expect(prompt).toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("Zero out-of-plan files");
  });

  it("returns the strict-executor prompt for qa-reviewer", () => {
    const prompt = getStrictPrompt("qa-reviewer");
    expect(prompt).toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).not.toContain("trust-recent-green");
  });

  it("returns the strict-executor prompt for pilot-builder", () => {
    const prompt = getStrictPrompt("pilot-builder");
    expect(prompt).toContain("STRICT_EXECUTOR_VARIANT");
  });

  it("throws for agents without a strict variant", () => {
    expect(() => getStrictPrompt("prime")).toThrow();
    expect(() => getStrictPrompt("docs-maintainer")).toThrow();
    expect(() => getStrictPrompt("code-searcher")).toThrow();
  });
});

describe("getReasoningPrompt", () => {
  it("returns the reasoning prompt for build", () => {
    const prompt = getReasoningPrompt("build");
    expect(prompt).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("Fenced plans");
  });

  it("returns the reasoning prompt for qa-reviewer", () => {
    const prompt = getReasoningPrompt("qa-reviewer");
    expect(prompt).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("trust-recent-green");
  });

  it("returns the reasoning prompt for pilot-builder", () => {
    const prompt = getReasoningPrompt("pilot-builder");
    expect(prompt).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("environment bootstrap");
  });

  it("throws for agents without a variant", () => {
    expect(() => getReasoningPrompt("prime")).toThrow();
  });
});

// ---- resolveHarnessModels — tier-based prompt selection ----

describe("resolveHarnessModels — mid-execute tier", () => {
  it("applies strict prompts when mid-execute is configured", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        mid: "anthropic/claude-sonnet-4-6",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // build, qa-reviewer, pilot-builder should have strict prompts
    expect((agents["build"]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents["qa-reviewer"]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents["pilot-builder"]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
  });

  it("applies the mid-execute model to executor agents", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        mid: "anthropic/claude-sonnet-4-6",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    expect(agents["build"]!.model).toBe("moonshotai/kimi-k2-6");
    expect(agents["qa-reviewer"]!.model).toBe("moonshotai/kimi-k2-6");
    expect(agents["pilot-builder"]!.model).toBe("moonshotai/kimi-k2-6");
  });

  it("mid-tier agents (docs-maintainer, lib-reader) get mid model, not mid-execute", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        mid: "anthropic/claude-sonnet-4-6",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    expect(agents["docs-maintainer"]!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agents["lib-reader"]!.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("keeps reasoning prompts when mid-execute is NOT configured (fallback to mid)", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        mid: "anthropic/claude-sonnet-4-6",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // No mid-execute configured → reasoning prompts stay
    expect((agents["build"]!.prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents["build"]!.prompt as string)).toContain("Fenced plans");
    expect((agents["qa-reviewer"]!.prompt as string)).toContain("trust-recent-green");
    expect((agents["pilot-builder"]!.prompt as string)).toContain("environment bootstrap");
  });

  it("falls back mid-execute agents to mid model when mid-execute not configured", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        mid: "anthropic/claude-sonnet-4-6",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // build, qa-reviewer, pilot-builder should get the mid model
    expect(agents["build"]!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agents["qa-reviewer"]!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agents["pilot-builder"]!.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("per-agent override takes precedence over tier", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        build: "anthropic/claude-opus-4-7",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // Per-agent override wins
    expect(agents["build"]!.model).toBe("anthropic/claude-opus-4-7");
    // But qa-reviewer still gets mid-execute
    expect(agents["qa-reviewer"]!.model).toBe("moonshotai/kimi-k2-6");
  });

  it("strict prompts still apply even when per-agent overrides model (tier is mid-execute)", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        build: "qwen/qwen3-coder",  // per-agent override
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // Per-agent override changes model but mid-execute is configured,
    // so strict prompts still apply to all executor agents
    expect(agents["build"]!.model).toBe("qwen/qwen3-coder");
    expect((agents["build"]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
  });
});

// ---- applyConfig integration ----

describe("applyConfig — mid-execute integration", () => {
  it("end-to-end: mid-execute configured → strict prompts in final config", () => {
    const config: any = {};
    const pluginOptions = {
      models: {
        deep: "anthropic/claude-opus-4-7",
        mid: "anthropic/claude-sonnet-4-6",
        "mid-execute": "moonshotai/kimi-k2-6",
        fast: "anthropic/claude-haiku-4-5",
      },
    };
    applyConfig(config, pluginOptions);

    expect((config.agent["build"].prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent["build"].model).toBe("moonshotai/kimi-k2-6");
    expect((config.agent["qa-reviewer"].prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent["pilot-builder"].model).toBe("moonshotai/kimi-k2-6");
  });

  it("end-to-end: no mid-execute → reasoning prompts, mid model", () => {
    const config: any = {};
    const pluginOptions = {
      models: {
        deep: "anthropic/claude-opus-4-7",
        mid: "anthropic/claude-sonnet-4-6",
        fast: "anthropic/claude-haiku-4-5",
      },
    };
    applyConfig(config, pluginOptions);

    expect((config.agent["build"].prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect((config.agent["build"].prompt as string)).toContain("Fenced plans");
    expect(config.agent["build"].model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("user-wins: user agent override is not clobbered by tier resolution", () => {
    const config: any = {
      agent: {
        build: {
          prompt: "user custom prompt",
          model: "custom/model",
          mode: "all",
        },
      },
    };
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        mid: "anthropic/claude-sonnet-4-6",
      },
    };
    applyConfig(config, pluginOptions);

    // User-wins: their override takes final precedence
    expect(config.agent["build"].prompt).toBe("user custom prompt");
    expect(config.agent["build"].model).toBe("custom/model");
  });

  it("no models config at all → default prompts and models", () => {
    const config: any = {};
    applyConfig(config);

    // Default: reasoning prompts, sonnet model
    expect((config.agent["build"].prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent["build"].model).toBe("anthropic/claude-sonnet-4-6");
  });
});
