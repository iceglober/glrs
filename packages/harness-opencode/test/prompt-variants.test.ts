/**
 * Tests for the tier-based prompt variant selection system.
 *
 * The harness supports four model tiers: deep, mid, mid-execute, fast.
 * Agents assigned to `mid-execute` get strict-executor prompts when that
 * tier is explicitly configured. When `mid-execute` is NOT configured,
 * those agents fall back to the `mid` tier model and use reasoning prompts.
 *
 * Covers:
 * 1. AGENT_TIERS — mid-execute assignments for build, spec-reviewer, code-reviewer.
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
import { AGENTS } from "@glrs-dev/agent-core";
import { resolveHarnessModels, applyConfig } from "../src/config-hook.js";

// ---- AGENT_TIERS ----

describe("AGENT_TIERS", () => {
  it("assigns build to mid-execute tier", () => {
    expect(AGENT_TIERS[AGENTS.BUILD]).toBe("mid-execute");
  });

  it("assigns spec-reviewer to mid-execute tier", () => {
    expect(AGENT_TIERS[AGENTS.SPEC_REVIEWER]).toBe("mid-execute");
  });

  it("assigns code-reviewer to mid-execute tier", () => {
    expect(AGENT_TIERS[AGENTS.CODE_REVIEWER]).toBe("mid-execute");
  });

  it("assigns docs-maintainer to mid tier (not mid-execute)", () => {
    expect(AGENT_TIERS[AGENTS.DOCS_MAINTAINER]).toBe("mid");
  });

  it("assigns lib-reader to mid tier", () => {
    expect(AGENT_TIERS[AGENTS.LIB_READER]).toBe("mid");
  });

  it("assigns prime to mid-execute tier", () => {
    expect(AGENT_TIERS[AGENTS.PRIME]).toBe("mid-execute");
  });

  it("assigns code-searcher to fast tier", () => {
    expect(AGENT_TIERS[AGENTS.CODE_SEARCHER]).toBe("fast");
  });
});

// ---- getStrictPrompt / getReasoningPrompt ----

describe("getStrictPrompt", () => {
  it("returns the strict-executor prompt for build", () => {
    const prompt = getStrictPrompt(AGENTS.BUILD);
    expect(prompt).toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("Zero out-of-plan files");
  });

  it("returns the strict-executor prompt for spec-reviewer", () => {
    const prompt = getStrictPrompt(AGENTS.SPEC_REVIEWER);
    expect(prompt).toContain("STRICT_EXECUTOR_VARIANT");
  });

  it("returns the strict-executor prompt for code-reviewer", () => {
    const prompt = getStrictPrompt(AGENTS.CODE_REVIEWER);
    expect(prompt).toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).not.toContain("trust-recent-green");
  });

  it("throws for agents without a strict variant", () => {
    expect(() => getStrictPrompt(AGENTS.PRIME)).toThrow();
    expect(() => getStrictPrompt(AGENTS.DOCS_MAINTAINER)).toThrow();
    expect(() => getStrictPrompt(AGENTS.CODE_SEARCHER)).toThrow();
  });
});

describe("getReasoningPrompt", () => {
  it("returns the reasoning prompt for build", () => {
    const prompt = getReasoningPrompt(AGENTS.BUILD);
    expect(prompt).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("Fenced plans");
  });

  it("returns the reasoning prompt for spec-reviewer", () => {
    const prompt = getReasoningPrompt(AGENTS.SPEC_REVIEWER);
    expect(prompt).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("PASS_SPEC");
  });

  it("returns the reasoning prompt for code-reviewer", () => {
    const prompt = getReasoningPrompt(AGENTS.CODE_REVIEWER);
    expect(prompt).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(prompt).toContain("trust-recent-green");
  });

  it("throws for agents without a variant", () => {
    expect(() => getReasoningPrompt(AGENTS.PRIME)).toThrow();
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

    // build, spec-reviewer, code-reviewer should have strict prompts
    expect((agents[AGENTS.BUILD]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents[AGENTS.SPEC_REVIEWER]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents[AGENTS.CODE_REVIEWER]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
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

    expect(agents[AGENTS.BUILD]!.model).toBe("moonshotai/kimi-k2-6");
    expect(agents[AGENTS.SPEC_REVIEWER]!.model).toBe("moonshotai/kimi-k2-6");
    expect(agents[AGENTS.CODE_REVIEWER]!.model).toBe("moonshotai/kimi-k2-6");
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

    expect(agents[AGENTS.DOCS_MAINTAINER]!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agents[AGENTS.LIB_READER]!.model).toBe("anthropic/claude-sonnet-4-6");
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
    expect((agents[AGENTS.BUILD]!.prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents[AGENTS.BUILD]!.prompt as string)).toContain("Fenced plans");
    expect((agents[AGENTS.SPEC_REVIEWER]!.prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect((agents[AGENTS.CODE_REVIEWER]!.prompt as string)).toContain("trust-recent-green");
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

    // build, spec-reviewer, code-reviewer should get the mid model
    expect(agents[AGENTS.BUILD]!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agents[AGENTS.SPEC_REVIEWER]!.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agents[AGENTS.CODE_REVIEWER]!.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("per-agent override takes precedence over tier", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        [AGENTS.BUILD]: "anthropic/claude-opus-4-7",
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // Per-agent override wins
    expect(agents[AGENTS.BUILD]!.model).toBe("anthropic/claude-opus-4-7");
    // But spec-reviewer still gets mid-execute
    expect(agents[AGENTS.SPEC_REVIEWER]!.model).toBe("moonshotai/kimi-k2-6");
  });

  it("strict prompts still apply even when per-agent overrides model (tier is mid-execute)", () => {
    const agents = createAgents();
    const config: any = {};
    const pluginOptions = {
      models: {
        "mid-execute": "moonshotai/kimi-k2-6",
        [AGENTS.BUILD]: "qwen/qwen3-coder",  // per-agent override
      },
    };
    resolveHarnessModels(agents, config, pluginOptions);

    // Per-agent override changes model but mid-execute is configured,
    // so strict prompts still apply to all executor agents
    expect(agents[AGENTS.BUILD]!.model).toBe("qwen/qwen3-coder");
    expect((agents[AGENTS.BUILD]!.prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
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

    expect((config.agent[AGENTS.BUILD].prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent[AGENTS.BUILD].model).toBe("moonshotai/kimi-k2-6");
    expect((config.agent[AGENTS.SPEC_REVIEWER].prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent[AGENTS.SPEC_REVIEWER].model).toBe("moonshotai/kimi-k2-6");
    expect((config.agent[AGENTS.CODE_REVIEWER].prompt as string)).toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent[AGENTS.CODE_REVIEWER].model).toBe("moonshotai/kimi-k2-6");
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

    expect((config.agent[AGENTS.BUILD].prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect((config.agent[AGENTS.BUILD].prompt as string)).toContain("Fenced plans");
    expect(config.agent[AGENTS.BUILD].model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("user-wins: user agent override is not clobbered by tier resolution", () => {
    const config: any = {
      agent: {
        [AGENTS.BUILD]: {
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
    expect(config.agent[AGENTS.BUILD].prompt).toBe("user custom prompt");
    expect(config.agent[AGENTS.BUILD].model).toBe("custom/model");
  });

  it("no models config at all → default prompts and models", () => {
    const config: any = {};
    applyConfig(config);

    // Default: reasoning prompts, sonnet model
    expect((config.agent[AGENTS.BUILD].prompt as string)).not.toContain("STRICT_EXECUTOR_VARIANT");
    expect(config.agent[AGENTS.BUILD].model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("assigns spec-reviewer to mid-execute tier", () => {
    expect(AGENT_TIERS[AGENTS.SPEC_REVIEWER]).toBe("mid-execute");
  });

  it("assigns code-reviewer to mid-execute tier", () => {
    expect(AGENT_TIERS[AGENTS.CODE_REVIEWER]).toBe("mid-execute");
  });
});
