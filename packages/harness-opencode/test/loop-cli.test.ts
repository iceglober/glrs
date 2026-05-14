/**
 * Tests for the `glrs oc loop` and `glrs oc autopilot` CLI commands
 * after PR 3's divergence.
 *
 * Contract for PR 3:
 *   - `loop` is the canonical command for the raw-prompt Ralph runner
 *   - `autopilot` is its own separate subcommand (interactive scoping walkthrough)
 *   - `autopilot` is NO LONGER an alias of `loop`
 *   - The top-level `--help` lists both `loop` and `autopilot` as separate entries
 *   - `loop --help` does NOT list `autopilot` as an alias
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

describe("loop / autopilot CLI divergence (PR 3)", () => {
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

  test("autopilot is no longer an alias of loop", () => {
    // After PR 3, `loop --help` must NOT list `autopilot` as an alias.
    const loopHelp = spawnSync(process.execPath, [cliJs, "loop", "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(loopHelp.status).toBe(0);
    // The loop help should not mention autopilot as an alias
    expect(loopHelp.stdout).not.toMatch(/alias:\s*autopilot/);
  });

  test("autopilot is registered as its own subcommand", () => {
    // After PR 3, `autopilot` must appear as its own entry in top-level --help.
    const result = spawnSync(process.execPath, [cliJs, "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    // autopilot should appear as a separate subcommand
    expect(result.stdout).toContain("autopilot");
    // It should NOT appear as an alias annotation of loop
    expect(result.stdout).not.toMatch(/alias:\s*autopilot/);
  });

  test("`autopilot` subcommand shows its own help", () => {
    const result = spawnSync(process.execPath, [cliJs, "autopilot", "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("autopilot");
    // autopilot help should NOT be identical to loop help (they're diverged)
    const loopHelp = spawnSync(process.execPath, [cliJs, "loop", "--help"], {
      env: dispatchedEnv,
      encoding: "utf8",
    });
    expect(result.stdout).not.toBe(loopHelp.stdout);
  });
});
