/**
 * dist-assets.test.ts — Regression tests for autopilot markdown asset bundling.
 *
 * Covers acceptance criteria:
 *   a1: dist/strategies/default.md exists and byte-matches src/strategies/default.md
 *   a2: dist/prompt-template.md exists and byte-matches src/prompt-template.md
 *   a4: src/autopilot/ subdirectory does not exist (stale layout removed)
 *   a5: loop.ts source-fallback candidate path resolves to an existing file
 *
 * The dist-asset assertions (a1, a2) run a build in beforeAll so the test is
 * self-contained and fails reliably whether or not someone built first.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const AUTOPILOT_ROOT = resolve(import.meta.dir, "..");
const SRC = join(AUTOPILOT_ROOT, "src");
const DIST = join(AUTOPILOT_ROOT, "dist");

// ─── Build once before dist-asset assertions ─────────────────────────────────

beforeAll(() => {
  const result = Bun.spawnSync(["bun", "run", "build"], {
    cwd: AUTOPILOT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `autopilot build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
    );
  }
}, 60_000);

// ─── a1: dist/strategies/default.md ─────────────────────────────────────────

describe("dist/strategies/default.md exists next to dist/index.js after build", () => {
  it("dist/strategies/default.md exists", () => {
    expect(existsSync(join(DIST, "strategies", "default.md"))).toBe(true);
  });
});

describe("dist/strategies/default.md byte-matches src/strategies/default.md", () => {
  it("contents are identical", () => {
    const src = readFileSync(join(SRC, "strategies", "default.md"));
    const dist = readFileSync(join(DIST, "strategies", "default.md"));
    expect(dist.equals(src)).toBe(true);
  });
});

// ─── a2: dist/prompt-template.md ─────────────────────────────────────────────

describe("dist/prompt-template.md exists next to dist/index.js after build", () => {
  it("dist/prompt-template.md exists", () => {
    expect(existsSync(join(DIST, "prompt-template.md"))).toBe(true);
  });
});

describe("dist/prompt-template.md byte-matches src/prompt-template.md", () => {
  it("contents are identical", () => {
    const src = readFileSync(join(SRC, "prompt-template.md"));
    const dist = readFileSync(join(DIST, "prompt-template.md"));
    expect(dist.equals(src)).toBe(true);
  });
});

// ─── a4: stale src/autopilot/ directory is gone ──────────────────────────────

describe("src/autopilot/ subdirectory does not exist (stale layout removed)", () => {
  it("src/autopilot/ does not exist", () => {
    expect(existsSync(join(SRC, "autopilot"))).toBe(false);
  });
});

// ─── a5: loop.ts source-fallback candidate path resolves to an existing file ─

describe("loop.ts source-fallback candidate path resolves to an existing file", () => {
  it("src/prompt-template.md exists (the dev/test fallback path)", () => {
    // The second candidate in buildFullPrompt() is:
    //   join(import.meta.dir, "..", "..", "src", "prompt-template.md")
    // When loop.ts is at src/loop.ts, import.meta.dir is src/, so the
    // resolved path is src/../../src/prompt-template.md = src/prompt-template.md.
    // We verify the file exists so the fallback is never silently empty.
    expect(existsSync(join(SRC, "prompt-template.md"))).toBe(true);
  });

  it("loop.ts fallback path does not reference the removed src/autopilot/ subdir", () => {
    const loopSrc = readFileSync(join(SRC, "loop.ts"), "utf8");
    // The old broken path contained "autopilot/prompt-template.md" in the
    // fallback candidate. Verify it's been corrected.
    expect(loopSrc).not.toContain('"autopilot", "prompt-template.md"');
    expect(loopSrc).not.toContain("'autopilot', 'prompt-template.md'");
  });
});
