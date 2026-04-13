import { describe, test, expect, beforeAll } from "bun:test";
import { execaSync } from "execa";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "../../../dist/index.js");
const run = (...args: string[]) =>
  execaSync("node", [CLI, "state", "task", ...args], {
    reject: false,
    stderr: "pipe",
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
