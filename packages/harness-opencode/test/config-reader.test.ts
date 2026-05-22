/**
 * Tests for config-reader.ts
 *
 * Tests the reading, parsing, and validation of `.glrs/autopilot.yaml`.
 * Covers:
 *   - Missing file (returns null, never throws)
 *   - Empty file (returns empty config)
 *   - Valid complete configs
 *   - Valid partial configs
 *   - Unknown top-level keys (rejected with clear error)
 *   - Unknown nested keys (rejected with clear error)
 *   - Invalid YAML syntax (clear error message)
 *   - Type validation (adapter, models, etc.)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readAutopilotConfig } from "../src/autopilot/config-reader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-reader-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(content: string): string {
  const glrsDir = path.join(tmpDir, ".glrs");
  fs.mkdirSync(glrsDir, { recursive: true });
  const configPath = path.join(glrsDir, "autopilot.yaml");
  fs.writeFileSync(configPath, content);
  return tmpDir;
}

describe("readAutopilotConfig", () => {
  describe("missing file", () => {
    it("returns null when .glrs/autopilot.yaml doesn't exist", () => {
      const result = readAutopilotConfig(tmpDir);
      expect(result).toBeNull();
    });

    it("never throws when file is missing", () => {
      expect(() => readAutopilotConfig(tmpDir)).not.toThrow();
    });
  });

  describe("empty file", () => {
    it("returns empty object when file is empty", () => {
      const root = writeConfig("");
      const result = readAutopilotConfig(root);
      expect(result).toEqual({});
    });

    it("returns empty object when file contains only whitespace", () => {
      const root = writeConfig("   \n\n  ");
      const result = readAutopilotConfig(root);
      expect(result).toEqual({});
    });

    it("returns empty object when file contains only a comment", () => {
      const root = writeConfig("# This is a comment");
      const result = readAutopilotConfig(root);
      expect(result).toEqual({});
    });
  });

  describe("valid complete config", () => {
    it("parses a complete config with all fields", () => {
      const yaml = `
adapter: opencode
models:
  enrichment: deep
  execution: autopilot-execute
  debrief: mid
agents:
  build:
    model: custom
  review:
    timeout: 5000
enrichment:
  timeout: 60000
execution:
  maxRetries: 3
hooks:
  after_plan: echo done
  before_execute:
    - echo step1
    - echo step2
phases:
  wave_0:
    parallel: true
  wave_1:
    timeout: 120000
adapters:
  opencode:
    agents:
      build:
        model: deep
  claude_code_cli:
    skip_permissions: false
    allowed_tools:
      - bash
      - read
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);

      expect(result).toBeDefined();
      expect(result?.adapter).toBe("opencode");
      expect(result?.models?.enrichment).toBe("deep");
      expect(result?.models?.execution).toBe("autopilot-execute");
      expect(result?.models?.debrief).toBe("mid");
      expect(result?.agents?.build).toBeDefined();
      expect(result?.enrichment?.timeout).toBe(60000);
      expect(result?.execution?.maxRetries).toBe(3);
      expect(result?.hooks?.after_plan).toBe("echo done");
      expect(Array.isArray(result?.hooks?.before_execute)).toBe(true);
      expect(result?.phases?.wave_0).toBeDefined();
      expect(result?.adapters?.opencode?.agents?.build).toBeDefined();
      expect(result?.adapters?.claude_code_cli?.skip_permissions).toBe(false);
    });
  });

  describe("valid partial configs", () => {
    it("parses config with only adapter", () => {
      const root = writeConfig("adapter: claude-code-cli");
      const result = readAutopilotConfig(root);
      expect(result?.adapter).toBe("claude-code-cli");
    });

    it("parses config with only models", () => {
      const root = writeConfig("models:\n  enrichment: deep");
      const result = readAutopilotConfig(root);
      expect(result?.models?.enrichment).toBe("deep");
    });

    it("parses config with only hooks", () => {
      const root = writeConfig("hooks:\n  after_plan: echo done");
      const result = readAutopilotConfig(root);
      expect(result?.hooks?.after_plan).toBe("echo done");
    });

    it("parses config with multiple hook formats", () => {
      const yaml = `
hooks:
  single: echo hello
  multiple:
    - echo 1
    - echo 2
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.hooks?.single).toBe("echo hello");
      expect(Array.isArray(result?.hooks?.multiple)).toBe(true);
    });

    it("parses config with only adapter-specific config", () => {
      const yaml = `
adapters:
  claude_code_cli:
    skip_permissions: true
    allowed_tools: [bash, read]
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.adapters?.claude_code_cli?.skip_permissions).toBe(true);
      expect(result?.adapters?.claude_code_cli?.allowed_tools).toEqual([
        "bash",
        "read",
      ]);
    });
  });

  describe("unknown keys", () => {
    it("rejects unknown top-level keys", () => {
      const yaml = `
adapter: opencode
unknown_field: value
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow(
        /unknown keys.*unknown_field/,
      );
    });

    it("lists all unknown top-level keys in error", () => {
      const yaml = `
adapter: opencode
bad_field_1: value
bad_field_2: value
bad_field_3: value
`;
      const root = writeConfig(yaml);
      let errorMessage = "";
      try {
        readAutopilotConfig(root);
      } catch (err) {
        errorMessage = (err as Error).message;
      }
      expect(errorMessage).toContain("bad_field_1");
      expect(errorMessage).toContain("bad_field_2");
      expect(errorMessage).toContain("bad_field_3");
    });

    it("rejects unknown keys in models", () => {
      const yaml = `
models:
  enrichment: deep
  unknown_model: bad
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow(
        /unknown keys.*unknown_model/,
      );
    });

    it("rejects unknown keys in adapters.opencode", () => {
      const yaml = `
adapters:
  opencode:
    bad_key: value
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow(
        /unknown keys.*bad_key/,
      );
    });

    it("rejects unknown keys in adapters.claude_code_cli", () => {
      const yaml = `
adapters:
  claude_code_cli:
    skip_permissions: true
    bad_field: value
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow(
        /unknown keys.*bad_field/,
      );
    });

    it("allows unknown keys in flexible objects (agents, phases, enrichment, execution)", () => {
      const yaml = `
agents:
  build:
    model: custom
    timeout: 5000
    unknown_field: value
enrichment:
  anything: goes
execution:
  foo: bar
phases:
  wave_0:
    custom_field: value
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.agents?.build).toBeDefined();
      expect(result?.enrichment?.anything).toBe("goes");
      expect(result?.execution?.foo).toBe("bar");
      expect(result?.phases?.wave_0).toBeDefined();
    });
  });

  describe("type validation", () => {
    it("rejects invalid adapter values", () => {
      const yaml = `adapter: invalid-adapter`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow();
    });

    it("accepts 'opencode' as adapter", () => {
      const root = writeConfig("adapter: opencode");
      const result = readAutopilotConfig(root);
      expect(result?.adapter).toBe("opencode");
    });

    it("accepts 'claude-code-cli' as adapter", () => {
      const root = writeConfig("adapter: claude-code-cli");
      const result = readAutopilotConfig(root);
      expect(result?.adapter).toBe("claude-code-cli");
    });

    it("rejects non-boolean skip_permissions", () => {
      const yaml = `
adapters:
  claude_code_cli:
    skip_permissions: "true"
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow();
    });

    it("accepts boolean skip_permissions", () => {
      const yaml = `
adapters:
  claude_code_cli:
    skip_permissions: false
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.adapters?.claude_code_cli?.skip_permissions).toBe(false);
    });

    it("rejects non-array allowed_tools", () => {
      const yaml = `
adapters:
  claude_code_cli:
    allowed_tools: bash
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow();
    });

    it("accepts array allowed_tools", () => {
      const yaml = `
adapters:
  claude_code_cli:
    allowed_tools: [bash, read, write]
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.adapters?.claude_code_cli?.allowed_tools).toEqual([
        "bash",
        "read",
        "write",
      ]);
    });

    it("rejects hooks with non-string or non-array values", () => {
      const yaml = `
hooks:
  bad_hook: 123
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow();
    });

    it("accepts hooks as strings or arrays of strings", () => {
      const yaml = `
hooks:
  hook1: echo test
  hook2: [echo a, echo b]
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.hooks?.hook1).toBe("echo test");
      expect(Array.isArray(result?.hooks?.hook2)).toBe(true);
    });
  });

  describe("YAML parsing errors", () => {
    it("throws with clear message on invalid YAML syntax", () => {
      const yaml = `
adapter: opencode
models:
  enrichment: [invalid yaml structure
`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow(
        /Failed to parse.*autopilot.yaml/,
      );
    });

    it("throws with clear message on malformed YAML", () => {
      const yaml = `key: value: extra`;
      const root = writeConfig(yaml);
      expect(() => readAutopilotConfig(root)).toThrow(
        /Failed to parse.*autopilot.yaml/,
      );
    });
  });

  describe("edge cases", () => {
    it("returns partial config when some optional fields are omitted", () => {
      const yaml = `
adapter: opencode
models:
  enrichment: deep
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.adapter).toBe("opencode");
      expect(result?.models?.enrichment).toBe("deep");
      expect(result?.models?.execution).toBeUndefined();
    });

    it("handles deeply nested custom structures in flexible fields", () => {
      const yaml = `
enrichment:
  nested:
    deeply:
      structure:
        value: 42
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.enrichment?.nested).toBeDefined();
    });

    it("preserves complex data types in flexible fields", () => {
      const yaml = `
execution:
  list_value: [1, 2, 3]
  number: 42
  string: hello
  boolean: true
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(Array.isArray(result?.execution?.list_value)).toBe(true);
      expect(result?.execution?.number).toBe(42);
      expect(result?.execution?.string).toBe("hello");
      expect(result?.execution?.boolean).toBe(true);
    });

    it("handles empty adapters section", () => {
      const yaml = `
adapter: opencode
adapters: {}
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.adapter).toBe("opencode");
      expect(result?.adapters).toEqual({});
    });

    it("handles both opencode and claude_code_cli adapters simultaneously", () => {
      const yaml = `
adapters:
  opencode:
    agents: {}
  claude_code_cli:
    skip_permissions: true
`;
      const root = writeConfig(yaml);
      const result = readAutopilotConfig(root);
      expect(result?.adapters?.opencode?.agents).toEqual({});
      expect(result?.adapters?.claude_code_cli?.skip_permissions).toBe(true);
    });
  });
});
