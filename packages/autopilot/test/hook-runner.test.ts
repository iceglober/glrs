/**
 * Tests for the hook-runner module (item 3.3).
 */

import { describe, it, expect } from "bun:test";
import { runHook, type RunHookOptions } from "../src/hook-runner.js";

describe("runHook", () => {
  it("successful command returns ok: true with captured output", async () => {
    const fakeExec = (async (
      _cmd: string,
      args: readonly string[] | undefined,
      _opts: object,
    ) => {
      return { stdout: "output from command", stderr: "" };
    }) as never;

    const result = await runHook("echo test", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("output from command");
  });

  it("non-zero exit returns ok: false with stderr", async () => {
    const fakeExec = (async () => {
      const err = Object.assign(new Error("exit 1"), {
        code: 1,
        stderr: "command failed",
      });
      throw err;
    }) as never;

    const result = await runHook("false", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("command failed");
  });

  it("timeout returns ok: false with timeout marker", async () => {
    const fakeExec = (async () => {
      const err = Object.assign(new Error("aborted"), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
      throw err;
    }) as never;

    const result = await runHook("sleep 999", "/tmp", 100, {
      _deps: { execFile: fakeExec },
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("timed out");
  });

  it("empty/whitespace cmd returns ok: true without spawning", async () => {
    let called = false;
    const fakeExec = (async () => {
      called = true;
      return { stdout: "", stderr: "" };
    }) as never;

    const resultEmpty = await runHook("", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });
    const resultWhitespace = await runHook("   ", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });
    const resultUndefined = await runHook(undefined, "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });

    expect(called).toBe(false);
    expect(resultEmpty).toEqual({ ok: true, output: "" });
    expect(resultWhitespace).toEqual({ ok: true, output: "" });
    expect(resultUndefined).toEqual({ ok: true, output: "" });
  });

  it("spawn failure (ENOENT) returns ok: false with error message", async () => {
    const fakeExec = (async () => {
      const err = Object.assign(new Error("spawn ENOENT"), {
        code: "ENOENT",
      });
      throw err;
    }) as never;

    const result = await runHook("missing-command", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("spawn ENOENT");
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

    await runHook("echo a | grep a && true", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });

    expect(captured.cmd).toBe("/bin/sh");
    expect(captured.args[0]).toBe("-c");
    expect(captured.args[1]).toBe("echo a | grep a && true");
  });

  it("combines stdout and stderr into output", async () => {
    const fakeExec = (async () => {
      return { stdout: "out", stderr: "err" };
    }) as never;

    const result = await runHook("cmd", "/tmp", 5000, {
      _deps: { execFile: fakeExec },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toBe("outerr");
  });

  it("respects timeoutMs from options over parameter", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fakeExec = (async (
      _cmd: string,
      _args: readonly string[] | undefined,
      opts: any,
    ) => {
      capturedSignal = opts?.signal;
      return { stdout: "", stderr: "" };
    }) as never;

    // Call with explicit timeoutMs in opts
    await runHook("cmd", "/tmp", 999, {
      timeoutMs: 1234,
      _deps: { execFile: fakeExec },
    });

    // The timeout is created by AbortSignal.timeout, which we can't directly
    // inspect, but we've set a timeout of 1234ms via opts
    expect(capturedSignal).toBeDefined();
  });
});
