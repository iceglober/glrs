/**
 * vendored-autopilot-assets.test.ts — End-to-end regression test for the
 * vendored autopilot markdown assets in the CLI build.
 *
 * Covers acceptance criterion a3:
 *   After `bun run build` in packages/cli, the vendored autopilot dist
 *   contains both strategies/default.md and prompt-template.md — the exact
 *   paths the user's installed CLI looks at when running `glrs autopilot`.
 *
 * This catches any future regression where the vendor step might skip .md
 * files (e.g., someone replaces the recursive cpSync with a *.js-only copy).
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";

const CLI_ROOT = resolve(import.meta.dir, "..");
const VENDOR_AUTOPILOT = join(
  CLI_ROOT,
  "dist",
  "node_modules",
  "@glrs-dev",
  "autopilot",
);

beforeAll(async () => {
  const result = await $`bun run build`.cwd(CLI_ROOT).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
    );
  }
}, 120_000);

// ─── a3: vendored autopilot dist contains markdown assets ────────────────────

describe("vendored autopilot dist contains strategies/default.md after cli build", () => {
  it("dist/node_modules/@glrs-dev/autopilot/dist/strategies/default.md exists", () => {
    expect(
      existsSync(join(VENDOR_AUTOPILOT, "dist", "strategies", "default.md")),
    ).toBe(true);
  });
});

describe("vendored autopilot dist contains prompt-template.md after cli build", () => {
  it("dist/node_modules/@glrs-dev/autopilot/dist/prompt-template.md exists", () => {
    expect(
      existsSync(join(VENDOR_AUTOPILOT, "dist", "prompt-template.md")),
    ).toBe(true);
  });
});
