import { describe, it, expect } from "bun:test";
import { parseJsonc } from "../src/lib/jsonc.js";

describe("parseJsonc", () => {
  it("parses strict JSON", () => {
    expect(parseJsonc('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });

  it("tolerates a trailing comma (the opencode-config case)", () => {
    expect(parseJsonc('{\n  "name": "x",\n}')).toEqual({ name: "x" });
    expect(parseJsonc('{"a":[1,2,]}')).toEqual({ a: [1, 2] });
  });

  it("tolerates comments", () => {
    expect(parseJsonc('{\n  // a comment\n  "a": 1 /* inline */\n}')).toEqual({ a: 1 });
  });

  it("re-throws the strict error for genuinely malformed input", () => {
    expect(() => parseJsonc("{ invalid json }")).toThrow();
    expect(() => parseJsonc("not json at all")).toThrow();
  });

  it("does not invent values — empty object stays empty", () => {
    expect(parseJsonc("{}")).toEqual({});
  });
});
