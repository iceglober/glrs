import { describe, it, expect } from "bun:test";
import { autoName } from "./worktree.js";

describe("autoName", () => {
  it("produces a wt-YYMMDD-HHMMSS-<suffix> slug", () => {
    const fixed = new Date("2026-04-19T13:07:42");
    expect(autoName(fixed, "abc")).toBe("wt-260419-130742-abc");
  });

  it("zero-pads single digits", () => {
    const fixed = new Date("2026-01-02T03:04:05");
    expect(autoName(fixed, "zzz")).toBe("wt-260102-030405-zzz");
  });

  it("sorts lexically by time when suffix is stable", () => {
    const a = autoName(new Date("2026-04-19T10:00:00"), "aaa");
    const b = autoName(new Date("2026-04-19T11:00:00"), "aaa");
    expect(a < b).toBe(true);
  });

  it("includes a random suffix by default for collision resistance", () => {
    const fixed = new Date("2026-04-19T13:07:42");
    const a = autoName(fixed);
    expect(a).toMatch(/^wt-260419-130742-[a-z0-9]{3}$/);
  });
});
