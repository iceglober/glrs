/**
 * Tests for config resolution with plan-specific overrides.
 *
 * Tests the reading and merging of project-level and plan-specific configurations.
 * Covers:
 *   - Missing configs (returns DEFAULT_AUTOPILOT_CONFIG)
 *   - Project-level config only
 *   - Plan-specific config overriding defaults
 *   - Field-level merging (only overridden fields change)
 *   - Plan slug derivation from various path formats
 *   - Unknown slug (fallback to project layer)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveConfig } from "../src/autopilot/config-reader.js";
import { DEFAULT_AUTOPILOT_CONFIG } from "../src/autopilot/autopilot-config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-resolution-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeProjectConfig(content: string): void {
  const glrsDir = path.join(tmpDir, ".glrs");
  fs.mkdirSync(glrsDir, { recursive: true });
  const configPath = path.join(glrsDir, "autopilot.yaml");
  fs.writeFileSync(configPath, content);
}

function writePlanConfig(slug: string, content: string): void {
  const planDir = path.join(tmpDir, ".glrs", "plans", slug);
  fs.mkdirSync(planDir, { recursive: true });
  const configPath = path.join(planDir, "autopilot.yaml");
  fs.writeFileSync(configPath, content);
}

describe("resolveConfig", () => {
  describe("no configs", () => {
    it("returns DEFAULT_AUTOPILOT_CONFIG when no configs exist", () => {
      const result = resolveConfig(tmpDir, ".");
      expect(result).toEqual(DEFAULT_AUTOPILOT_CONFIG);
    });

    it("returns DEFAULT_AUTOPILOT_CONFIG when planPath is . and no project config", () => {
      const result = resolveConfig(tmpDir, ".");
      expect(result.adapter).toBe("opencode");
      expect(result.models?.enrichment).toBe("deep");
      expect(result.agents).toEqual({});
    });
  });

  describe("project-level config only", () => {
    it("returns merged config when only project config exists", () => {
      const projectYaml = `
adapter: claude-code-cli
models:
  enrichment: custom-model
`;
      writeProjectConfig(projectYaml);

      const result = resolveConfig(tmpDir, ".");
      expect(result.adapter).toBe("claude-code-cli");
      expect(result.models?.enrichment).toBe("custom-model");
      // Other fields come from defaults
      expect(result.models?.execution).toBe("autopilot-execute");
    });

    it("merges partial project config with defaults", () => {
      const projectYaml = `
hooks:
  after_plan: echo done
`;
      writeProjectConfig(projectYaml);

      const result = resolveConfig(tmpDir, ".");
      expect(result.hooks?.after_plan).toBe("echo done");
      expect(result.adapter).toBe("opencode"); // from defaults
      expect(result.models?.enrichment).toBe("deep"); // from defaults
    });
  });

  describe("plan slug derivation", () => {
    it("derives slug from directory path with trailing slash", () => {
      writePlanConfig("v2_2", "adapter: claude-code-cli");

      const result = resolveConfig(tmpDir, "docs/plans/v2_2/");
      expect(result.adapter).toBe("claude-code-cli");
    });

    it("derives slug from directory path without trailing slash", () => {
      writePlanConfig("v2_2", "adapter: claude-code-cli");

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.adapter).toBe("claude-code-cli");
    });

    it("derives slug from markdown file path", () => {
      writePlanConfig("v2_2", "adapter: claude-code-cli");

      const result = resolveConfig(tmpDir, "docs/plans/v2_2.md");
      expect(result.adapter).toBe("claude-code-cli");
    });

    it("handles nested plan paths", () => {
      writePlanConfig("my_plan", "models:\n  execution: custom");

      const result = resolveConfig(tmpDir, "docs/plans/nested/folder/my_plan/");
      expect(result.models?.execution).toBe("custom");
    });
  });

  describe("plan-specific overrides", () => {
    it("plan config overrides project config field-level", () => {
      writeProjectConfig("adapter: opencode\nmodels:\n  enrichment: project-model");
      writePlanConfig("v2_2", "models:\n  enrichment: plan-model");

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.adapter).toBe("opencode"); // from project
      expect(result.models?.enrichment).toBe("plan-model"); // from plan
      expect(result.models?.execution).toBe("autopilot-execute"); // from defaults
    });

    it("plan config with single model field overrides only that field", () => {
      writeProjectConfig(`
models:
  enrichment: deep
  execution: autopilot-execute
  debrief: mid
`);
      writePlanConfig("v2_2", "models:\n  execution: custom-execute");

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.models?.enrichment).toBe("deep"); // from project
      expect(result.models?.execution).toBe("custom-execute"); // from plan
      expect(result.models?.debrief).toBe("mid"); // from project
    });

    it("plan overrides project, project overrides defaults", () => {
      writeProjectConfig("adapter: claude-code-cli");
      writePlanConfig("v2_2", "models:\n  enrichment: plan-specific");

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.adapter).toBe("claude-code-cli");
      expect(result.models?.enrichment).toBe("plan-specific");
      expect(result.models?.execution).toBe("autopilot-execute"); // from defaults
    });

    it("plan config overrides nested phase configuration", () => {
      writeProjectConfig("phases:\n  wave_0:\n    timeout: 60000");
      writePlanConfig(
        "v2_2",
        "phases:\n  wave_0:\n    parallel: true\n  wave_1:\n    timeout: 120000",
      );

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      // Phase config from plan replaces project phase entirely (phase-level replacement)
      expect(result.phases?.wave_0).toBeDefined();
      expect((result.phases?.wave_0 as Record<string, unknown>).parallel).toBe(true);
      expect((result.phases?.wave_1 as Record<string, unknown>).timeout).toBe(120000);
    });
  });

  describe("adapter-specific config", () => {
    it("merges adapters config from project and plan", () => {
      writeProjectConfig(`
adapters:
  opencode:
    agents:
      build:
        model: deep
`);
      writePlanConfig("v2_2", `
adapters:
  opencode:
    agents:
      review:
        timeout: 5000
`);

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.adapters?.opencode?.agents?.build).toBeDefined();
      expect(result.adapters?.opencode?.agents?.review).toBeDefined();
    });

    it("plan adapter config overrides project adapter config field-level", () => {
      writeProjectConfig(`
adapters:
  claude_code_cli:
    skip_permissions: false
    allowed_tools: [bash, read]
`);
      writePlanConfig("v2_2", `
adapters:
  claude_code_cli:
    skip_permissions: true
`);

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.adapters?.claude_code_cli?.skip_permissions).toBe(true); // from plan
      expect(result.adapters?.claude_code_cli?.allowed_tools).toEqual([
        "bash",
        "read",
      ]); // from project
    });
  });

  describe("unknown slug", () => {
    it("returns project + defaults when plan config doesn't exist", () => {
      writeProjectConfig("adapter: claude-code-cli");
      // No plan config written

      const result = resolveConfig(tmpDir, "docs/plans/nonexistent");
      expect(result.adapter).toBe("claude-code-cli"); // from project
      expect(result.models?.enrichment).toBe("deep"); // from defaults
    });

    it("falls back to project layer for missing plan directory", () => {
      const projectYaml = `
adapter: opencode
models:
  enrichment: project-deep
`;
      writeProjectConfig(projectYaml);

      const result = resolveConfig(tmpDir, "docs/plans/missing_plan/");
      expect(result.adapter).toBe("opencode");
      expect(result.models?.enrichment).toBe("project-deep");
    });
  });

  describe("empty plan path", () => {
    it("treats empty string as no plan path", () => {
      writeProjectConfig("adapter: claude-code-cli");

      const result = resolveConfig(tmpDir, "");
      expect(result.adapter).toBe("claude-code-cli");
    });

    it("treats . as no plan path", () => {
      writeProjectConfig("adapter: opencode");

      const result = resolveConfig(tmpDir, ".");
      expect(result.adapter).toBe("opencode");
    });
  });

  describe("complex merging scenarios", () => {
    it("deeply nested object merge", () => {
      writeProjectConfig(`
enrichment:
  timeout: 60000
  retries: 3
execution:
  maxParallel: 5
`);
      writePlanConfig("v2_2", `
enrichment:
  timeout: 120000
`);

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect((result.enrichment as Record<string, unknown>).timeout).toBe(120000);
      expect((result.enrichment as Record<string, unknown>).retries).toBe(3);
      expect((result.execution as Record<string, unknown>).maxParallel).toBe(5);
    });

    it("agent override merge", () => {
      writeProjectConfig(`
agents:
  build:
    model: deep
    timeout: 300000
  review:
    model: mid
`);
      writePlanConfig("v2_2", `
agents:
  build:
    timeout: 600000
`);

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect((result.agents?.build as Record<string, unknown>).model).toBe("deep");
      expect((result.agents?.build as Record<string, unknown>).timeout).toBe(600000);
      expect((result.agents?.review as Record<string, unknown>).model).toBe("mid");
    });

    it("multiple hook formats preserved through merge", () => {
      writeProjectConfig(`
hooks:
  after_plan: echo project
  before_execute:
    - echo 1
    - echo 2
`);
      writePlanConfig("v2_2", `
hooks:
  after_plan: echo plan
`);

      const result = resolveConfig(tmpDir, "docs/plans/v2_2");
      expect(result.hooks?.after_plan).toBe("echo plan");
      expect(result.hooks?.before_execute).toEqual(["echo 1", "echo 2"]);
    });
  });

  describe("config validation in plan resolution", () => {
    it("throws when plan config has unknown keys", () => {
      writeProjectConfig("adapter: opencode");
      writePlanConfig("v2_2", "unknown_field: value");

      expect(() => resolveConfig(tmpDir, "docs/plans/v2_2")).toThrow(
        /unknown keys.*unknown_field/,
      );
    });

    it("throws when plan config has invalid YAML", () => {
      writeProjectConfig("adapter: opencode");
      writePlanConfig("v2_2", "models:\n  enrichment: [invalid");

      expect(() => resolveConfig(tmpDir, "docs/plans/v2_2")).toThrow(
        /Failed to parse plan config/,
      );
    });

    it("throws when project config has unknown keys (before plan resolution)", () => {
      writeProjectConfig("bad_field: value");

      expect(() => resolveConfig(tmpDir, ".")).toThrow(/unknown keys.*bad_field/);
    });
  });

  describe("default population", () => {
    it("ensures all default fields are present in resolved config", () => {
      const result = resolveConfig(tmpDir, ".");

      expect(result.adapter).toBeDefined();
      expect(result.models).toBeDefined();
      expect(result.agents).toBeDefined();
      expect(result.enrichment).toBeDefined();
      expect(result.execution).toBeDefined();
      expect(result.hooks).toBeDefined();
      expect(result.phases).toBeDefined();
      expect(result.adapters).toBeDefined();
      expect(result.adapters?.opencode).toBeDefined();
      expect(result.adapters?.claude_code_cli).toBeDefined();
    });

    it("preserves default values when no project or plan config overrides them", () => {
      const result = resolveConfig(tmpDir, ".");

      expect(result.adapter).toBe(DEFAULT_AUTOPILOT_CONFIG.adapter);
      expect(result.models?.enrichment).toBe(DEFAULT_AUTOPILOT_CONFIG.models?.enrichment);
      expect(result.models?.execution).toBe(DEFAULT_AUTOPILOT_CONFIG.models?.execution);
      expect(result.models?.debrief).toBe(DEFAULT_AUTOPILOT_CONFIG.models?.debrief);
    });
  });

  describe("path edge cases", () => {
    it("handles plan path with spaces", () => {
      writePlanConfig("my plan", "adapter: claude-code-cli");

      const result = resolveConfig(tmpDir, "docs/plans/my plan/");
      expect(result.adapter).toBe("claude-code-cli");
    });

    it("handles plan path with hyphens and underscores", () => {
      writePlanConfig("v2-2_plan", "adapter: claude-code-cli");

      const result = resolveConfig(tmpDir, "docs/plans/v2-2_plan");
      expect(result.adapter).toBe("claude-code-cli");
    });

    it("uses basename even with complex directory structure", () => {
      writePlanConfig("final", "models:\n  enrichment: final-model");

      const result = resolveConfig(tmpDir, "a/b/c/d/e/final/");
      expect(result.models?.enrichment).toBe("final-model");
    });
  });
});
