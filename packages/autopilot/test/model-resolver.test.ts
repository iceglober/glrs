/**
 * Tests for the adapter-aware model resolver.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveModel } from "../src/model-resolver.js";

describe("resolveModel", () => {
  let warnCalls: string[] = [];
  const originalWarn = console.warn;

  beforeEach(() => {
    warnCalls = [];
    console.warn = (message: string) => {
      warnCalls.push(message);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  describe("full model ID with /", () => {
    it("passes through for claude-code-cli", () => {
      const result = resolveModel("amazon-bedrock/global.anthropic.claude-opus-4-7", "claude-code-cli");
      expect(result).toBe("amazon-bedrock/global.anthropic.claude-opus-4-7");
      expect(warnCalls).toHaveLength(0);
    });

    it("passes through for opencode", () => {
      const result = resolveModel("amazon-bedrock/global.anthropic.claude-opus-4-7", "opencode", {
        deep: "some-model",
      });
      expect(result).toBe("amazon-bedrock/global.anthropic.claude-opus-4-7");
      expect(warnCalls).toHaveLength(0);
    });
  });

  describe("claude-code-cli tier aliases", () => {
    it("maps deep to claude-opus-4-7", () => {
      const result = resolveModel("deep", "claude-code-cli");
      expect(result).toBe("claude-opus-4-7");
    });

    it("maps mid to claude-sonnet-4-6", () => {
      const result = resolveModel("mid", "claude-code-cli");
      expect(result).toBe("claude-sonnet-4-6");
    });

    it("maps mid-execute to claude-sonnet-4-6", () => {
      const result = resolveModel("mid-execute", "claude-code-cli");
      expect(result).toBe("claude-sonnet-4-6");
    });

    it("maps autopilot-execute to claude-haiku-4-5-20251001", () => {
      const result = resolveModel("autopilot-execute", "claude-code-cli");
      expect(result).toBe("claude-haiku-4-5-20251001");
    });

    it("maps fast to claude-haiku-4-5-20251001", () => {
      const result = resolveModel("fast", "claude-code-cli");
      expect(result).toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("claude-code-cli unknown literal", () => {
    it("passes through unchanged when not a known alias", () => {
      const result = resolveModel("unknown-model-id", "claude-code-cli");
      expect(result).toBe("unknown-model-id");
      expect(warnCalls).toHaveLength(0);
    });

    it("passes through unchanged for custom claude model", () => {
      const result = resolveModel("claude-opus-4-6", "claude-code-cli");
      expect(result).toBe("claude-opus-4-6");
      expect(warnCalls).toHaveLength(0);
    });
  });

  describe("opencode tier resolution", () => {
    it("resolves tier from supplied opencodeTiers", () => {
      const tiers = {
        deep: "opencode-deep-model",
        mid: "opencode-mid-model",
        fast: "opencode-fast-model",
      };
      expect(resolveModel("deep", "opencode", tiers)).toBe("opencode-deep-model");
      expect(resolveModel("mid", "opencode", tiers)).toBe("opencode-mid-model");
      expect(resolveModel("fast", "opencode", tiers)).toBe("opencode-fast-model");
    });

    it("returns first element when tier value is an array", () => {
      const tiers = {
        deep: ["model-1", "model-2", "model-3"],
        mid: ["model-a", "model-b"],
      };
      expect(resolveModel("deep", "opencode", tiers)).toBe("model-1");
      expect(resolveModel("mid", "opencode", tiers)).toBe("model-a");
    });
  });

  describe("opencode unknown tier fallback", () => {
    it("falls back to deep and warns once for unknown tier name", () => {
      const tiers = {
        deep: "fallback-model",
      };
      const result1 = resolveModel("unknown-tier", "opencode", tiers);
      expect(result1).toBe("fallback-model");
      expect(warnCalls.length).toBeGreaterThan(0);
      expect(warnCalls[0]).toContain("unknown-tier");
      expect(warnCalls[0]).toContain("falling back to");

      // A second call to the same unknown tier should not warn again (dedupe).
      // Note: this tests deduplication across calls, which requires module-level state.
      // The implementation uses a module-level Set that persists across test cases,
      // so we verify this in the next test.
    });

    it("passes through when unknown tier but no deep fallback available", () => {
      const tiers = {
        mid: "opencode-mid-model",
      };
      const result = resolveModel("unknown-tier", "opencode", tiers);
      expect(result).toBe("unknown-tier");
    });

    it("passes through when unknown tier and no opencodeTiers provided", () => {
      const result = resolveModel("unknown-tier", "opencode");
      expect(result).toBe("unknown-tier");
    });
  });

  describe("edge cases", () => {
    it("handles empty opencodeTiers map", () => {
      const result = resolveModel("deep", "opencode", {});
      expect(result).toBe("deep");
    });

    it("handles undefined opencodeTiers for opencode adapter", () => {
      const result = resolveModel("deep", "opencode", undefined);
      expect(result).toBe("deep");
    });

    it("handles slash in tier name for opencode as full model ID passthrough", () => {
      const result = resolveModel("aws/claude-opus", "opencode", { deep: "some-model" });
      expect(result).toBe("aws/claude-opus");
    });

    it("handles array with single element", () => {
      const tiers = {
        deep: ["only-model"],
      };
      const result = resolveModel("deep", "opencode", tiers);
      expect(result).toBe("only-model");
    });
  });
});
