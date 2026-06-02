import { describe, it, expect, afterEach } from "bun:test";
import { __test__ } from "../src/lib/analytics.js";

const { host, DEFAULT_HOST, DEFAULT_PROJECT_KEY } = __test__;

describe("analytics ingest host", () => {
  const saved = process.env["COUNTED_HOST"];
  afterEach(() => {
    if (saved === undefined) delete process.env["COUNTED_HOST"];
    else process.env["COUNTED_HOST"] = saved;
  });

  it("defaults to the live ingest host, NOT the SDK's dead `counted.dev`", () => {
    // Regression guard: the SDK defaults `host` to https://counted.dev, which
    // has no DNS record — events posted there silently vanish. We must point at
    // https://app.counted.dev.
    expect(DEFAULT_HOST).toBe("https://app.counted.dev");
    expect(DEFAULT_HOST).not.toContain("//counted.dev");
    delete process.env["COUNTED_HOST"];
    expect(host()).toBe("https://app.counted.dev");
  });

  it("respects COUNTED_HOST override", () => {
    process.env["COUNTED_HOST"] = "https://example.test";
    expect(host()).toBe("https://example.test");
  });

  it("keeps the embedded write-only project key", () => {
    expect(DEFAULT_PROJECT_KEY).toBe("ck_94C4F7AE8481D5C51695");
  });
});
