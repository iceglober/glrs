/**
 * Tests for the scope-validator module (item 4.2).
 */

import { describe, it, expect } from "bun:test";
import {
  validateScope,
  getChangedFiles,
} from "../src/scope-validator.js";

describe("validateScope", () => {
  it("returns empty arrays when expected and actual are identical", () => {
    const r = validateScope(["a.ts", "b.ts"], ["a.ts", "b.ts"]);
    expect(r.extra).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("flags extra files (scope drift) when agent touched files not in plan", () => {
    const r = validateScope(["a.ts"], ["a.ts", "b.ts"]);
    expect(r.extra).toEqual(["b.ts"]);
    expect(r.missing).toEqual([]);
  });

  it("flags missing files (incomplete) when plan expects files not touched", () => {
    const r = validateScope(["a.ts", "b.ts"], ["a.ts"]);
    expect(r.extra).toEqual([]);
    expect(r.missing).toEqual(["b.ts"]);
  });

  it("reports both extra and missing", () => {
    const r = validateScope(["a.ts", "b.ts"], ["a.ts", "c.ts"]);
    expect(r.extra).toEqual(["c.ts"]);
    expect(r.missing).toEqual(["b.ts"]);
  });

  it("ignores empty/whitespace-only entries", () => {
    const r = validateScope(["a.ts", "", "  "], ["a.ts", "", "b.ts"]);
    expect(r.extra).toEqual(["b.ts"]);
    expect(r.missing).toEqual([]);
  });

  it("dedupes within each input", () => {
    const r = validateScope(["a.ts", "a.ts"], ["a.ts", "a.ts"]);
    expect(r.extra).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("returns sorted arrays", () => {
    const r = validateScope(["c.ts"], ["b.ts", "a.ts"]);
    expect(r.extra).toEqual(["a.ts", "b.ts"]);
  });
});

describe("getChangedFiles", () => {
  it("parses one file per line from git diff output", async () => {
    const fakeExec = (async () => ({
      stdout: "src/a.ts\nsrc/b.ts\n",
      stderr: "",
    })) as never;
    const result = await getChangedFiles("/tmp", "HEAD~1", {
      _deps: { execFile: fakeExec },
    });
    expect(result).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("filters blank lines", async () => {
    const fakeExec = (async () => ({
      stdout: "src/a.ts\n\nsrc/b.ts\n\n",
      stderr: "",
    })) as never;
    const result = await getChangedFiles("/tmp", "HEAD~1", {
      _deps: { execFile: fakeExec },
    });
    expect(result).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns [] on git failure (degraded path)", async () => {
    const fakeExec = (async () => {
      throw new Error("not a git repo");
    }) as never;
    const result = await getChangedFiles("/tmp", "HEAD", {
      _deps: { execFile: fakeExec },
    });
    expect(result).toEqual([]);
  });

  it("returns [] when git output is empty", async () => {
    const fakeExec = (async () => ({ stdout: "", stderr: "" })) as never;
    const result = await getChangedFiles("/tmp", "HEAD", {
      _deps: { execFile: fakeExec },
    });
    expect(result).toEqual([]);
  });
});
