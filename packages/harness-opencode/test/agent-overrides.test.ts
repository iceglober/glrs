import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { applyAgentOverrides, createAgents } from "../src/agents/index.js";
import { AGENTS } from "@glrs-dev/agent-core";

describe("applyAgentOverrides", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-overrides-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: spy on console.warn, run `fn`, return result and captured warnings.
   */
  function capturingWarn<T>(fn: () => T): { result: T; warnings: string[] } {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    try {
      const result = fn();
      return { result, warnings };
    } finally {
      console.warn = original;
    }
  }

  it("model-only override updates agent.model and leaves prompt untouched", () => {
    const agents = createAgents();
    const originalBuildPrompt = agents[AGENTS.BUILD].prompt;

    const overrides = {
      [AGENTS.BUILD]: { model: "custom-model-123" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents[AGENTS.BUILD].model).toBe("custom-model-123");
    expect(agents[AGENTS.BUILD].prompt).toBe(originalBuildPrompt);
  });

  it("prompt override reads file and applies placeholder injections", () => {
    const agents = createAgents();

    // Create a custom prompt file with placeholders
    const customPromptContent = "Test prompt\n{WORKFLOW_MECHANICS_RULE}\nEnd";
    fs.writeFileSync(path.join(tmpDir, "custom.md"), customPromptContent);

    const overrides = {
      [AGENTS.PRIME]: { prompt: "custom.md" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    // Verify the prompt was read and placeholders were injected
    expect(agents[AGENTS.PRIME].prompt).toContain("Test prompt");
    expect(agents[AGENTS.PRIME].prompt).not.toContain("{WORKFLOW_MECHANICS_RULE}");
    // The placeholder should be replaced with the actual rule
    expect(agents[AGENTS.PRIME].prompt.length).toBeGreaterThan(customPromptContent.length);
  });

  it("both model and prompt override work together", () => {
    const agents = createAgents();

    const customPromptContent = "Custom prompt for build agent";
    fs.writeFileSync(path.join(tmpDir, "build-custom.md"), customPromptContent);

    const overrides = {
      [AGENTS.BUILD]: {
        model: "new-build-model",
        prompt: "build-custom.md",
      },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents[AGENTS.BUILD].model).toBe("new-build-model");
    expect(agents[AGENTS.BUILD].prompt).toContain("Custom prompt for build agent");
  });

  it("unknown agent name logs warning and is ignored", () => {
    const agents = createAgents();
    const originalBuildModel = agents[AGENTS.BUILD].model;

    const overrides = {
      "nonexistent-agent": { model: "should-be-ignored" },
      [AGENTS.BUILD]: { model: "valid-model" },
    };

    const { warnings } = capturingWarn(() =>
      applyAgentOverrides(agents, overrides, tmpDir),
    );

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unknown agent");
    expect(warnings[0]).toContain("nonexistent-agent");
    // The valid override should still work
    expect(agents[AGENTS.BUILD].model).toBe("valid-model");
  });

  it("absolute path for prompt throws with clear error", () => {
    const agents = createAgents();

    const overrides = {
      [AGENTS.PRIME]: { prompt: "/absolute/path/to/custom.md" },
    };

    expect(() => applyAgentOverrides(agents, overrides, tmpDir)).toThrow(
      /absolute path not allowed/,
    );
  });

  it("missing prompt file throws with helpful error", () => {
    const agents = createAgents();

    const overrides = {
      [AGENTS.PRIME]: { prompt: "missing.md" },
    };

    expect(() => applyAgentOverrides(agents, overrides, tmpDir)).toThrow(
      /failed to read prompt file/,
    );
  });

  it("empty overrides map is a no-op", () => {
    const agents = createAgents();
    const originalAgent = { ...agents[AGENTS.BUILD] };

    applyAgentOverrides(agents, {}, tmpDir);

    expect(agents[AGENTS.BUILD]).toEqual(originalAgent);
  });

  it("undefined overrides is a no-op", () => {
    const agents = createAgents();
    const originalAgent = { ...agents[AGENTS.BUILD] };

    applyAgentOverrides(agents, undefined, tmpDir);

    expect(agents[AGENTS.BUILD]).toEqual(originalAgent);
  });

  it("mutates agents in place and returns same reference", () => {
    const agents = createAgents();
    const originalRef = agents;

    const overrides = {
      [AGENTS.PRIME]: { model: "test-model" },
    };

    const result = applyAgentOverrides(agents, overrides, tmpDir);

    expect(result).toBe(originalRef);
    expect(result.prime.model).toBe("test-model");
  });

  it("applies UI_EVALUATION_LADDER placeholder injection", () => {
    const agents = createAgents();

    const customPromptContent = "Test\n{UI_EVALUATION_LADDER}\nEnd";
    fs.writeFileSync(path.join(tmpDir, "ui.md"), customPromptContent);

    const overrides = {
      [AGENTS.PRIME]: { prompt: "ui.md" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents[AGENTS.PRIME].prompt).toContain("Test");
    expect(agents[AGENTS.PRIME].prompt).not.toContain("{UI_EVALUATION_LADDER}");
    expect(agents[AGENTS.PRIME].prompt.length).toBeGreaterThan(customPromptContent.length);
  });

  it("multiple overrides apply correctly", () => {
    const agents = createAgents();

    const scoperPrompt = "Scoper prompt";
    const planPrompt = "Plan prompt";
    fs.writeFileSync(path.join(tmpDir, "scoper.md"), scoperPrompt);
    fs.writeFileSync(path.join(tmpDir, "plan.md"), planPrompt);

    const overrides = {
      [AGENTS.SCOPER]: { model: "scoper-model", prompt: "scoper.md" },
      [AGENTS.PLAN]: { model: "plan-model", prompt: "plan.md" },
      [AGENTS.PRIME]: { model: "prime-model" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents[AGENTS.SCOPER].model).toBe("scoper-model");
    expect(agents[AGENTS.SCOPER].prompt).toContain("Scoper prompt");
    expect(agents[AGENTS.PLAN].model).toBe("plan-model");
    expect(agents[AGENTS.PLAN].prompt).toContain("Plan prompt");
    expect(agents[AGENTS.PRIME].model).toBe("prime-model");
  });

  it("prompt path resolution uses repo root correctly", () => {
    const agents = createAgents();

    // Create a subdirectory structure
    const subDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "custom.md"), "Subdir prompt");

    const overrides = {
      [AGENTS.PRIME]: { prompt: "prompts/custom.md" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents[AGENTS.PRIME].prompt).toContain("Subdir prompt");
  });
});

describe("temperature override", () => {
  it("applies a numeric temperature and ignores non-numbers", async () => {
    const { createAgents, applyAgentOverrides } = await import("../src/agents/index.js");
    const agents = createAgents();
    applyAgentOverrides(agents, { prime: { temperature: 0.7 } } as any, process.cwd());
    expect((agents as any)["prime"].temperature).toBe(0.7);
    applyAgentOverrides(agents, { prime: { temperature: "hot" } } as any, process.cwd());
    expect((agents as any)["prime"].temperature).toBe(0.7);
  });
});
