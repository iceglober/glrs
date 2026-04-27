import { describe, test, expect, beforeAll } from "bun:test";
import { execaSync } from "execa";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "../../../dist/index.js");
const run = (...args: string[]) =>
  execaSync("node", [CLI, "state", "task", ...args], {
    reject: false,
    stderr: "pipe",
    env: { ...process.env, GLRS_CLI_DISPATCHED: "1" },
  });

describe("state task CLI", () => {
  test("transition rejects missing --phase", () => {
    const result = run("transition", "--id", "t1");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--phase|No value/i);
  });

  test("transition --close-and-claim-next rejects non-terminal phase", () => {
    const result = run("transition", "--id", "t1", "--phase", "verify", "--close-and-claim-next");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/done.*cancelled/i);
  });

  test("transition --close-and-claim-next rejects --ids", () => {
    const result = run("transition", "--ids", "t1,t2", "--phase", "done", "--close-and-claim-next");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/cannot.*--ids/i);
  });

  test("transition rejects invalid phase", () => {
    const result = run("transition", "--id", "t1", "--phase", "bogus");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/invalid phase/i);
  });

  test("note requires --body", () => {
    const result = run("note", "--id", "t1");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--body|No value/i);
  });
});

// ── compactify unit tests ────────────────────────────────────────────

import { compactify } from "./task.js";

describe("compactify", () => {
  test("strips null fields", () => {
    expect(compactify({ a: null, b: "hi" })).toEqual({ b: "hi" });
  });

  test("strips undefined fields", () => {
    expect(compactify({ a: undefined, b: "hi" })).toEqual({ b: "hi" });
  });

  test("strips empty string fields", () => {
    expect(compactify({ a: "", b: "hi" })).toEqual({ b: "hi" });
  });

  test("strips empty array fields", () => {
    expect(compactify({ a: [], b: [1] })).toEqual({ b: [1] });
  });

  test("preserves false", () => {
    expect(compactify({ a: false, b: true })).toEqual({ a: false, b: true });
  });

  test("preserves zero", () => {
    expect(compactify({ a: 0, b: 1 })).toEqual({ a: 0, b: 1 });
  });

  test("preserves non-empty objects", () => {
    expect(compactify({ a: { nested: true } })).toEqual({ a: { nested: true } });
  });
});
