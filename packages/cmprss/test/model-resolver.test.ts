/**
 * Unit tests for the per-request Anthropic→Bedrock model resolver — the proxy's
 * one piece of pure, request-path logic. Covers region prefixing, alias and
 * dated-variant resolution, region fallback, Bedrock pass-through, and errors.
 */

import { describe, it, expect } from "bun:test";
import {
  bedrockFromAnthropic,
  knownAnthropicModels,
  regionPrefix,
  ModelNotFound,
} from "../src/aws/model-resolver.js";

describe("regionPrefix", () => {
  it("maps AWS regions to Bedrock inference-profile prefixes", () => {
    expect(regionPrefix("us-east-1")).toBe("us");
    expect(regionPrefix("us-gov-west-1")).toBe("us");
    expect(regionPrefix("eu-west-1")).toBe("eu");
    expect(regionPrefix("ap-southeast-2")).toBe("au");
    expect(regionPrefix("ap-northeast-1")).toBe("jp");
    expect(regionPrefix("ap-south-1")).toBe("apac");
  });

  it("falls back to the global profile for unknown regions", () => {
    expect(regionPrefix("xx-nowhere-9")).toBe("global");
  });
});

describe("bedrockFromAnthropic", () => {
  it("resolves an anthropic name to a region-prefixed Bedrock id", () => {
    expect(bedrockFromAnthropic("claude-sonnet-4-5", "us-east-1")).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    expect(bedrockFromAnthropic("claude-sonnet-4-5", "eu-west-1")).toBe(
      "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
  });

  it("treats a dated alias as the same family", () => {
    expect(
      bedrockFromAnthropic("claude-sonnet-4-5-20250929", "us-east-1"),
    ).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0");
  });

  it("strips a leading `anthropic/` provider prefix", () => {
    expect(bedrockFromAnthropic("anthropic/claude-opus-4-8", "us-east-1")).toBe(
      "us.anthropic.claude-opus-4-8",
    );
  });

  it("falls back past an unavailable region prefix (opus-4-1 → none form in eu)", () => {
    // opus-4-1 is published only in `us` + `none`; from eu the preferred chain
    // [eu, global, none] lands on `none`, which returns the bare suffix.
    expect(bedrockFromAnthropic("claude-opus-4-1", "eu-west-1")).toBe(
      "anthropic.claude-opus-4-1-20250805-v1:0",
    );
  });

  it("passes through strings that already look like Bedrock ids", () => {
    const arn =
      "arn:aws:bedrock:us-east-1:123:inference-profile/us.anthropic.claude-x";
    expect(bedrockFromAnthropic(arn, "eu-west-1")).toBe(arn);
    expect(
      bedrockFromAnthropic("us.anthropic.claude-sonnet-4-5-20250929-v1:0", "eu-west-1"),
    ).toBe("us.anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(bedrockFromAnthropic("anthropic.claude-opus-4-8", "us-east-1")).toBe(
      "anthropic.claude-opus-4-8",
    );
  });

  it("returns null for an unknown model", () => {
    expect(bedrockFromAnthropic("gpt-4o", "us-east-1")).toBeNull();
  });
});

describe("knownAnthropicModels", () => {
  it("returns a sorted, non-empty list including a known alias", () => {
    const models = knownAnthropicModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("claude-sonnet-4-5");
    expect([...models]).toEqual([...models].sort());
  });
});

describe("ModelNotFound", () => {
  it("carries a 400/MODEL_NOT_FOUND and names the model in its message", () => {
    const err = new ModelNotFound("gpt-4o", "us-east-1");
    expect(err.status).toBe(400);
    expect(err.code).toBe("MODEL_NOT_FOUND");
    expect(err.message).toContain("gpt-4o");
    expect(err.message).toContain("us-east-1");
  });
});
