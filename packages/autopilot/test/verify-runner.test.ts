/**
 * Tests for the verify-runner module (item 4.1).
 */

import { describe, it, expect } from "bun:test";
import {
  runVerifyCommands,
  formatVerifyResultsTable,
  type VerifyResult,
} from "../src/verify-runner.js";
import type { PlanItem } from "../src/plan-parser.js";

function item(id: string, verify: string): PlanItem {
  return {
    id,
    intent: "",
    files: [],
    tests: [],
    verify,
    checked: false,
  };
}

describe("runVerifyCommands", () => {
  it("returns one result per item with a verify field", async () => {
    let called = 0;
    const fakeExec = (async (
      _cmd: string,
      args: readonly string[] | undefined,
      _opts: object,
    ) => {
      called++;
      return { stdout: `stdout-${args?.[1] ?? ""}`, stderr: "" };
    }) as never;

    const results = await runVerifyCommands(
      [item("4.1", "echo a"), item("4.2", "echo b")],
      "/tmp",
      { _deps: { execFile: fakeExec } },
    );

    expect(called).toBe(2);
    expect(results).toHaveLength(2);
    expect(results[0]?.itemId).toBe("4.1");
    expect(results[0]?.command).toBe("echo a");
    expect(results[0]?.passed).toBe(true);
    expect(results[1]?.itemId).toBe("4.2");
    expect(results[1]?.passed).toBe(true);
  });

  it("skips items without a verify command", async () => {
    let called = 0;
    const fakeExec = (async () => {
      called++;
      return { stdout: "", stderr: "" };
    }) as never;

    const results = await runVerifyCommands(
      [item("a", ""), item("b", "   "), item("c", "echo ok")],
      "/tmp",
      { _deps: { execFile: fakeExec } },
    );

    expect(called).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.itemId).toBe("c");
  });

  it("captures non-zero exits as passed: false with stdout/stderr", async () => {
    const fakeExec = (async () => {
      const err = Object.assign(new Error("exit 1"), {
        code: 1,
        stdout: "some output",
        stderr: "boom",
      });
      throw err;
    }) as never;

    const results = await runVerifyCommands(
      [item("4.1", "false")],
      "/tmp",
      { _deps: { execFile: fakeExec } },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.stdout).toBe("some output");
    expect(results[0]?.stderr).toBe("boom");
  });

  it("captures timeout (AbortError) with synthetic stderr message", async () => {
    const fakeExec = (async () => {
      const err = Object.assign(new Error("aborted"), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
      throw err;
    }) as never;

    const results = await runVerifyCommands(
      [item("4.1", "sleep 999")],
      "/tmp",
      { timeoutMs: 100, _deps: { execFile: fakeExec } },
    );

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.stderr).toContain("timed out");
  });

  it("never throws — spawn failures become passed: false", async () => {
    const fakeExec = (async () => {
      const err = Object.assign(new Error("spawn ENOENT"), {
        code: "ENOENT",
      });
      throw err;
    }) as never;

    const results = await runVerifyCommands(
      [item("4.1", "missing-cmd")],
      "/tmp",
      { _deps: { execFile: fakeExec } },
    );

    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.stderr).toContain("spawn ENOENT");
  });

  it("uses /bin/sh -c so shell features work", async () => {
    let captured: { cmd: string; args: readonly string[] } = {
      cmd: "",
      args: [],
    };
    const fakeExec = (async (
      cmd: string,
      args: readonly string[] | undefined,
    ) => {
      captured = { cmd, args: args ?? [] };
      return { stdout: "", stderr: "" };
    }) as never;

    await runVerifyCommands(
      [item("4.1", "echo a | grep a && true")],
      "/tmp",
      { _deps: { execFile: fakeExec } },
    );

    expect(captured.cmd).toBe("/bin/sh");
    expect(captured.args[0]).toBe("-c");
    expect(captured.args[1]).toBe("echo a | grep a && true");
  });
});

describe("formatVerifyResultsTable", () => {
  it("returns empty string when no results", () => {
    expect(formatVerifyResultsTable([])).toBe("");
  });

  it("renders a markdown table with pass/fail status", () => {
    const results: VerifyResult[] = [
      {
        itemId: "4.1",
        command: "bun test foo.test.ts",
        passed: true,
        stdout: "",
        stderr: "",
        durationMs: 250,
      },
      {
        itemId: "4.2",
        command: "bun run typecheck",
        passed: false,
        stdout: "",
        stderr: "TS2304",
        durationMs: 12_000,
      },
    ];
    const table = formatVerifyResultsTable(results);
    expect(table).toContain("| 4.1 |");
    expect(table).toContain("✓ pass");
    expect(table).toContain("✗ fail");
    expect(table).toContain("250ms");
    expect(table).toContain("12.0s");
  });

  it("truncates long commands", () => {
    const results: VerifyResult[] = [
      {
        itemId: "x",
        command: "a".repeat(120),
        passed: true,
        stdout: "",
        stderr: "",
        durationMs: 1,
      },
    ];
    const table = formatVerifyResultsTable(results);
    expect(table).toContain("...");
  });
});
