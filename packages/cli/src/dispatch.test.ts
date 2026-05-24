/**
 * Tests that `glrs` dispatches subcommands correctly.
 *
 * Prerequisites: @glrs-dev/cli must be built before this test runs.
 * Skips gracefully when binaries are missing.
 */
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = resolve(pkgDir, "dist/cli.js");

function isCliBuilt(): boolean {
  return existsSync(cliJs);
}

describe("glrs CLI", () => {
  test("glrs --help prints top-level help", () => {
    if (!isCliBuilt()) {
      console.log("SKIP: cli not built — run `bun run build` first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toContain("glrs — unified CLI");
    expect(output).toContain("harness");
    expect(output).toContain("wt");
  });

  test("glrs wt --help prints worktree help natively", () => {
    if (!isCliBuilt()) {
      console.log("SKIP: cli not built — run `bun run build` first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "wt", "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toContain("worktree management");
    expect(output).toContain("new");
    expect(output).toContain("list");
    expect(output).toContain("switch");
    expect(output).toContain("delete");
    expect(output).toContain("cleanup");
  });

  test("glrs oc shows deprecation notice and redirects to harness", () => {
    if (!isCliBuilt()) {
      console.log("SKIP: cli not built — run `bun run build` first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "oc", "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toContain("deprecated");
    expect(output).toContain("glrs harness");
  });

  test("glrs <unknown> prints unknown-subcommand error", () => {
    if (!isCliBuilt()) {
      console.log("SKIP: cli not built — run `bun run build` first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "not-a-real-subcommand"], {
      encoding: "utf8",
      timeout: 15000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr ?? "").toContain("Unknown subcommand");
  });
});
