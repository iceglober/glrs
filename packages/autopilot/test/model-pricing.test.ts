/**
 * Tests for the model-pricing module.
 *
 * Covers:
 *   - estimateCost returns correct values for known models
 *   - estimateCost returns 0 for unknown models
 *   - findPricing matches by substring (case-insensitive)
 *   - Pricing formula: (input * inputRate + output * outputRate) / 1_000_000
 */

import { describe, it, expect } from "bun:test";
import { estimateCost, findPricing, MODEL_PRICING } from "../src/lib/model-pricing.js";

describe("MODEL_PRICING", () => {
  it("has entries for Opus, Sonnet, and Haiku", () => {
    expect(MODEL_PRICING["claude-3-opus"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku"]).toBeDefined();
  });

  it("Opus pricing is $15/$75 per million tokens", () => {
    expect(MODEL_PRICING["claude-3-opus"]).toEqual({ input: 15, output: 75 });
  });

  it("Sonnet pricing is $3/$15 per million tokens", () => {
    expect(MODEL_PRICING["claude-sonnet"]).toEqual({ input: 3, output: 15 });
  });

  it("current Haiku (4.5) pricing is $1/$5 per million tokens", () => {
    expect(MODEL_PRICING["claude-haiku"]).toEqual({ input: 1, output: 5 });
  });

  it("legacy Haiku 3 keeps its historical $0.25/$1.25 pricing", () => {
    expect(MODEL_PRICING["claude-3-haiku"]).toEqual({ input: 0.25, output: 1.25 });
  });

  it("current Opus (4.5+) pricing is $5/$25; Opus 4.1 keeps $15/$75", () => {
    expect(MODEL_PRICING["claude-opus"]).toEqual({ input: 5, output: 25 });
    expect(MODEL_PRICING["claude-opus-4-1"]).toEqual({ input: 15, output: 75 });
  });
});

describe("findPricing", () => {
  it("matches Opus by full model ID", () => {
    const p = findPricing("anthropic.claude-3-opus-20240229-v1:0");
    expect(p).toBeDefined();
    expect(p!.input).toBe(15);
    expect(p!.output).toBe(75);
  });

  it("matches Sonnet by full model ID", () => {
    const p = findPricing("anthropic.claude-3-5-sonnet-20241022-v2:0");
    expect(p).toBeDefined();
    expect(p!.input).toBe(3);
    expect(p!.output).toBe(15);
  });

  it("matches Haiku by full model ID", () => {
    const p = findPricing("anthropic.claude-3-haiku-20240307-v1:0");
    expect(p).toBeDefined();
    expect(p!.input).toBe(0.25);
    expect(p!.output).toBe(1.25);
  });

  it("is case-insensitive", () => {
    const p = findPricing("ANTHROPIC.CLAUDE-SONNET");
    expect(p).toBeDefined();
  });

  it("returns undefined for unknown models", () => {
    expect(findPricing("unknown-model-xyz")).toBeUndefined();
    expect(findPricing("kimi-k1")).toBeUndefined();
    expect(findPricing("")).toBeUndefined();
  });

  it("matches current Opus generations at the repriced rate", () => {
    const p = findPricing("global.anthropic.claude-opus-4-7");
    expect(p).toEqual({ input: 5, output: 25 });
  });
});

describe("estimateCost", () => {
  it("returns 0 for unknown model", () => {
    expect(estimateCost("unknown-model", { input: 1000, output: 500 })).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost("claude-3-opus", { input: 0, output: 0 })).toBe(0);
  });

  it("computes correct cost for Opus with 1M input tokens", () => {
    // 1M input tokens at $15/M = $15
    const cost = estimateCost("claude-3-opus", { input: 1_000_000, output: 0 });
    expect(cost).toBeCloseTo(15, 6);
  });

  it("computes correct cost for Opus with 1M output tokens", () => {
    // 1M output tokens at $75/M = $75
    const cost = estimateCost("claude-3-opus", { input: 0, output: 1_000_000 });
    expect(cost).toBeCloseTo(75, 6);
  });

  it("computes correct cost for Sonnet with mixed tokens", () => {
    // 100K input at $3/M + 50K output at $15/M = $0.30 + $0.75 = $1.05
    const cost = estimateCost("claude-sonnet", { input: 100_000, output: 50_000 });
    expect(cost).toBeCloseTo(1.05, 6);
  });

  it("computes correct cost for current Haiku with small token counts", () => {
    // 10K input at $1/M + 5K output at $5/M = $0.01 + $0.025 = $0.035
    const cost = estimateCost("claude-haiku-4-5", { input: 10_000, output: 5_000 });
    expect(cost).toBeCloseTo(0.035, 6);
  });

  it("matches by full Bedrock model ID", () => {
    const cost = estimateCost(
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      { input: 1_000_000, output: 0 },
    );
    expect(cost).toBeCloseTo(3, 6);
  });

  it("prices GLM-5 at the models.dev catalog rate ($1/$3.20)", () => {
    // 1M input at $1/M + 1M output at $3.2/M
    const cost = estimateCost("zai.glm-5", { input: 1_000_000, output: 1_000_000 });
    expect(cost).toBeCloseTo(4.2, 6);
  });

  it("returns 0 for Kimi (TBD pricing)", () => {
    expect(estimateCost("kimi-k1-5", { input: 1000, output: 500 })).toBe(0);
  });
});
