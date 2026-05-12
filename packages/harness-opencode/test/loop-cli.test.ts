/**
 * Tests for the `glrs oc loop` + `glrs oc autopilot` command alias
 * introduced in PR 2 of the loop/autopilot split.
 *
 * Contract for this PR:
 *   - `loop` is the canonical command name
 *   - `autopilot` is an alias that resolves to the same implementation
 *   - Both produce help output (identical modulo the usage-line banner
 *     which normalizes to the canonical name)
 *   - The top-level `--help` lists `loop` with `[alias: autopilot]`
 *
 * PR 3 will diverge these: `autopilot` will become its own interactive
 * scoping walkthrough and will no longer be a `loop` alias. When that
 * happens, this test file gets rewritten, not extended.
 */

import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = resolve(pkgDir, "dist/cli.js");

const dispatchedEnv = {
  ...process.env,
  // Bypass the standalone-bin redirect; this runs harness-opencode's
  // own cli.ts directly as if dispatched from @glrs-dev/cli.
  GLRS_CLI_DISPATCHED: "1",
  // Prevent accidental auto-update during tests.
  GLRS_AUTO_UPDATE: "0",
};

describe("loop / autopilot CLI alias (PR 2)", () => {
  test("`loop` subcommand is registered and shows help", () => {
    const result = spawnSync(process.execPath, [cliJs, "loop", "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("glrs-oc loop");
    expect(result.stdout).toContain("Ralph loop");
    expect(result.stdout).toContain("<autopilot-done>");
    expect(result.stdout).toContain("--max-iterations");
    expect(result.stdout).toContain("--timeout");
  });

  test("`autopilot` alias resolves to the same command (identical help body)", () => {
    const loopHelp = spawnSync(process.execPath, [cliJs, "loop", "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    const autopilotHelp = spawnSync(process.execPath, [cliJs, "autopilot", "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(loopHelp.status).toBe(0);
    expect(autopilotHelp.status).toBe(0);

    // cmd-ts normalizes aliased-subcommand help to the canonical name,
    // so the banner line reads `glrs-oc loop` in both cases. The full
    // help body is byte-identical.
    expect(autopilotHelp.stdout).toBe(loopHelp.stdout);
  });

  test("top-level --help lists `loop` with `[alias: autopilot]`", () => {
    const result = spawnSync(process.execPath, [cliJs, "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    // cmd-ts formats aliased subcommands as "name [alias: other]"
    expect(result.stdout).toContain("loop");
    expect(result.stdout).toMatch(/alias:\s*autopilot/);
  });

  test("top-level --help does NOT list `autopilot` as its own subcommand", () => {
    // Once the alias is set up, cmd-ts should list only the canonical
    // name with an alias annotation — not autopilot as a separate entry.
    // This guards against someone re-adding `autopilot: loopCmd` to the
    // subcommand map during PR 3, which would double-register and
    // produce misleading help output.
    const result = spawnSync(process.execPath, [cliJs, "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    // Count lines that start with a dash and contain "autopilot" outside
    // the alias annotation. Expected: zero.
    const separateAutopilotLines = result.stdout
      .split("\n")
      .filter((line) => /^- autopilot\b/.test(line));
    expect(separateAutopilotLines).toEqual([]);
  });
});
