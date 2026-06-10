import { describe, it, expect } from "bun:test";
import {
  round,
  normalizeFinish,
  buildModelTurnProps,
  inferToolOk,
  buildToolUsedProps,
  buildVerifyProps,
  extractSkillName,
} from "../src/lib/telemetry-events.js";

const TOKENS = { input: 100, output: 200, reasoning: 10, cache: { read: 5, write: 3 } };

describe("round", () => {
  it("rounds to the requested precision", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(10 / 3, 1)).toBe(3.3);
  });
  it("returns 0 for non-finite input", () => {
    expect(round(Infinity, 2)).toBe(0);
    expect(round(NaN, 2)).toBe(0);
  });
});

describe("normalizeFinish", () => {
  it("passes through known reasons (underscores → hyphens)", () => {
    expect(normalizeFinish("stop")).toBe("stop");
    expect(normalizeFinish("tool_calls")).toBe("tool-calls");
    expect(normalizeFinish("LENGTH")).toBe("length");
  });
  it("collapses unknown/empty to a safe enum", () => {
    expect(normalizeFinish("some-provider-specific-thing")).toBe("other");
    expect(normalizeFinish(undefined)).toBe("unknown");
    expect(normalizeFinish(null)).toBe("unknown");
  });
});

describe("buildModelTurnProps", () => {
  it("computes tps and duration from epoch-ms timestamps", () => {
    const p = buildModelTurnProps({
      provider: "anthropic",
      model: "claude-opus-4-8",
      cost: 0.123456789,
      tokens: TOKENS,
      createdMs: 1_000_000,
      completedMs: 1_010_000, // 10s
    });
    expect(p.provider).toBe("anthropic");
    expect(p.model).toBe("claude-opus-4-8");
    expect(p.cost).toBe(0.123457); // rounded to 6dp
    expect(p.output_tokens).toBe(200);
    expect(p.duration_ms).toBe(10_000);
    // tps counts GENERATED tokens (output + reasoning): (200 + 10) / 10s.
    // Providers like google-vertex report reasoning separately; excluding it
    // understated their generation rate ~2x.
    expect(p.tps).toBe(21);
    expect(p.outcome).toBe("ok");
    expect(p.finish).toBe("unknown");
    expect(p.error_kind).toBeUndefined();
    // Priced turn — no unpriced flag.
    expect(p.unpriced).toBeUndefined();
  });

  it("flags zero-cost turns with real tokens as unpriced (catalog gap)", () => {
    // e.g. azure-foundry models missing from the models.dev catalog report
    // cost=0 with real token usage — dashboards must be able to tell
    // "missing price" apart from "free".
    const p = buildModelTurnProps({
      provider: "azure-foundry",
      model: "DeepSeek-V4-Pro",
      cost: 0,
      tokens: TOKENS,
    });
    expect(p.unpriced).toBe(true);

    // Zero cost AND zero tokens (e.g. instantly-errored turn) is not a
    // pricing gap — no flag.
    const empty = buildModelTurnProps({
      provider: "x",
      model: "y",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    expect(empty.unpriced).toBeUndefined();
  });

  it("omits tps/duration when timing is missing or non-positive", () => {
    const noTime = buildModelTurnProps({
      provider: "x",
      model: "y",
      cost: 0,
      tokens: TOKENS,
    });
    expect(noTime.tps).toBeUndefined();
    expect(noTime.duration_ms).toBeUndefined();

    const zeroDur = buildModelTurnProps({
      provider: "x",
      model: "y",
      cost: 0,
      tokens: TOKENS,
      createdMs: 5,
      completedMs: 5,
    });
    expect(zeroDur.tps).toBeUndefined();
  });

  it("marks an errored turn and carries the error kind enum", () => {
    const p = buildModelTurnProps({
      provider: "anthropic",
      model: "claude-opus-4-8",
      cost: 0,
      tokens: TOKENS,
      errorKind: "MessageAbortedError",
      finish: "aborted",
    });
    expect(p.outcome).toBe("error");
    expect(p.error_kind).toBe("MessageAbortedError");
    expect(p.finish).toBe("aborted");
  });

  it("includes preset only when provided", () => {
    expect(
      buildModelTurnProps({ provider: "x", model: "y", cost: 0, tokens: TOKENS, preset: "fast" })
        .preset,
    ).toBe("fast");
    expect(
      buildModelTurnProps({ provider: "x", model: "y", cost: 0, tokens: TOKENS }).preset,
    ).toBeUndefined();
  });
});

describe("inferToolOk", () => {
  it("defaults to ok for normal output", () => {
    expect(inferToolOk("read", "some file contents")).toBe(true);
    expect(inferToolOk("bash", "hello\nworld")).toBe(true);
  });
  it("flags bash non-zero exits", () => {
    expect(inferToolOk("bash", "boom\nExit code: 1")).toBe(false);
    expect(inferToolOk("bash", "command failed")).toBe(false);
  });
  it("does not flag a zero exit", () => {
    expect(inferToolOk("bash", "ok\nExit code: 0")).toBe(true);
  });
  it("respects a truthy metadata.error for any tool", () => {
    expect(inferToolOk("read", "x", { error: "ENOENT" })).toBe(false);
    expect(inferToolOk("read", "x", { error: null })).toBe(true);
  });
});

describe("buildToolUsedProps", () => {
  it("includes skill and preset only when set, defaults provider/model to unknown", () => {
    expect(buildToolUsedProps({ tool: "read", ok: true })).toEqual({
      provider: "unknown",
      model: "unknown",
      tool: "read",
      ok: true,
    });
    expect(
      buildToolUsedProps({
        tool: "skill",
        ok: false,
        provider: "anthropic",
        model: "claude-opus-4-8",
        skill: "code-quality",
        preset: "fast",
      }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      tool: "skill",
      ok: false,
      skill: "code-quality",
      preset: "fast",
    });
  });
});

describe("buildVerifyProps", () => {
  it("ok=true when no errors, carries provider/model", () => {
    expect(
      buildVerifyProps({
        errorCount: 0,
        tool: "edit",
        provider: "anthropic",
        model: "claude-opus-4-8",
      }),
    ).toEqual({
      ok: true,
      errors: 0,
      lang: "ts",
      provider: "anthropic",
      model: "claude-opus-4-8",
      tool: "edit",
    });
  });
  it("defaults provider/model to unknown when omitted", () => {
    const p = buildVerifyProps({ errorCount: 0, tool: "edit" });
    expect(p.provider).toBe("unknown");
    expect(p.model).toBe("unknown");
  });
  it("ok=false with the error count", () => {
    const p = buildVerifyProps({ errorCount: 3, tool: "write" });
    expect(p.ok).toBe(false);
    expect(p.errors).toBe(3);
  });
});

describe("extractSkillName", () => {
  it("derives the slug from skills_<name> / skill_<name>", () => {
    expect(extractSkillName("skills_code-quality")).toBe("code-quality");
    expect(extractSkillName("skill_design-for-ai")).toBe("design-for-ai");
  });
  it("reads the name from args for a bare skill tool", () => {
    expect(extractSkillName("skill", { name: "Code Quality" })).toBe("code-quality");
    expect(extractSkillName("skill", { skill: "research" })).toBe("research");
    expect(extractSkillName("skill", {})).toBeNull();
  });
  it("returns null for non-skill tools", () => {
    expect(extractSkillName("read")).toBeNull();
    expect(extractSkillName("bash")).toBeNull();
  });
});
