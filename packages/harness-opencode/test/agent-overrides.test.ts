import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { applyAgentOverrides, createAgents } from "../src/agents/index.js";

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
    const originalBuildPrompt = agents.build.prompt;

    const overrides = {
      build: { model: "custom-model-123" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents.build.model).toBe("custom-model-123");
    expect(agents.build.prompt).toBe(originalBuildPrompt);
  });

  it("prompt override reads file and applies placeholder injections", () => {
    const agents = createAgents();

    // Create a custom prompt file with placeholders
    const customPromptContent = "Test prompt\n{WORKFLOW_MECHANICS_RULE}\nEnd";
    fs.writeFileSync(path.join(tmpDir, "custom.md"), customPromptContent);

    const overrides = {
      prime: { prompt: "custom.md" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    // Verify the prompt was read and placeholders were injected
    expect(agents.prime.prompt).toContain("Test prompt");
    expect(agents.prime.prompt).not.toContain("{WORKFLOW_MECHANICS_RULE}");
    // The placeholder should be replaced with the actual rule
    expect(agents.prime.prompt.length).toBeGreaterThan(customPromptContent.length);
  });

  it("both model and prompt override work together", () => {
    const agents = createAgents();

    const customPromptContent = "Custom prompt for build agent";
    fs.writeFileSync(path.join(tmpDir, "build-custom.md"), customPromptContent);

    const overrides = {
      build: {
        model: "new-build-model",
        prompt: "build-custom.md",
      },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents.build.model).toBe("new-build-model");
    expect(agents.build.prompt).toContain("Custom prompt for build agent");
  });

  it("unknown agent name logs warning and is ignored", () => {
    const agents = createAgents();
    const originalBuildModel = agents.build.model;

    const overrides = {
      "nonexistent-agent": { model: "should-be-ignored" },
      build: { model: "valid-model" },
    };

    const { warnings } = capturingWarn(() =>
      applyAgentOverrides(agents, overrides, tmpDir),
    );

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unknown agent");
    expect(warnings[0]).toContain("nonexistent-agent");
    // The valid override should still work
    expect(agents.build.model).toBe("valid-model");
  });

  it("absolute path for prompt throws with clear error", () => {
    const agents = createAgents();

    const overrides = {
      prime: { prompt: "/absolute/path/to/custom.md" },
    };

    expect(() => applyAgentOverrides(agents, overrides, tmpDir)).toThrow(
      /absolute path not allowed/,
    );
  });

  it("missing prompt file throws with helpful error", () => {
    const agents = createAgents();

    const overrides = {
      prime: { prompt: "missing.md" },
    };

    expect(() => applyAgentOverrides(agents, overrides, tmpDir)).toThrow(
      /failed to read prompt file/,
    );
  });

  it("empty overrides map is a no-op", () => {
    const agents = createAgents();
    const originalAgent = { ...agents.build };

    applyAgentOverrides(agents, {}, tmpDir);

    expect(agents.build).toEqual(originalAgent);
  });

  it("undefined overrides is a no-op", () => {
    const agents = createAgents();
    const originalAgent = { ...agents.build };

    applyAgentOverrides(agents, undefined, tmpDir);

    expect(agents.build).toEqual(originalAgent);
  });

  it("mutates agents in place and returns same reference", () => {
    const agents = createAgents();
    const originalRef = agents;

    const overrides = {
      prime: { model: "test-model" },
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
      prime: { prompt: "ui.md" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents.prime.prompt).toContain("Test");
    expect(agents.prime.prompt).not.toContain("{UI_EVALUATION_LADDER}");
    expect(agents.prime.prompt.length).toBeGreaterThan(customPromptContent.length);
  });

  it("multiple overrides apply correctly", () => {
    const agents = createAgents();

    const scoperPrompt = "Scoper prompt";
    const planPrompt = "Plan prompt";
    fs.writeFileSync(path.join(tmpDir, "scoper.md"), scoperPrompt);
    fs.writeFileSync(path.join(tmpDir, "plan.md"), planPrompt);

    const overrides = {
      scoper: { model: "scoper-model", prompt: "scoper.md" },
      plan: { model: "plan-model", prompt: "plan.md" },
      prime: { model: "prime-model" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents.scoper.model).toBe("scoper-model");
    expect(agents.scoper.prompt).toContain("Scoper prompt");
    expect(agents.plan.model).toBe("plan-model");
    expect(agents.plan.prompt).toContain("Plan prompt");
    expect(agents.prime.model).toBe("prime-model");
  });

  it("prompt path resolution uses repo root correctly", () => {
    const agents = createAgents();

    // Create a subdirectory structure
    const subDir = path.join(tmpDir, "prompts");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "custom.md"), "Subdir prompt");

    const overrides = {
      prime: { prompt: "prompts/custom.md" },
    };

    applyAgentOverrides(agents, overrides, tmpDir);

    expect(agents.prime.prompt).toContain("Subdir prompt");
  });
});
