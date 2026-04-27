/**
 * Tests that `glrs oc --help` dispatches to the real harness-opencode tool
 * (not the deprecation redirect), and that `glrs wt --help` works natively.
 *
 * Prerequisites: @glrs-dev/harness-plugin-opencode must be built before this test
 * runs. Skips gracefully when binaries are missing.
 */
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = resolve(pkgDir, "dist/cli.js");

const REDIRECT_SUBSTRING = "This binary is deprecated when invoked standalone.";

const req = createRequire(import.meta.url);

function isHarnessBuilt(): boolean {
  try {
    const pkgJson = req("@glrs-dev/harness-plugin-opencode/package.json") as {
      bin?: Record<string, string>;
    };
    const binKey = pkgJson.bin?.["harness-opencode"];
    if (!binKey) return false;
    const pkgPath = req.resolve("@glrs-dev/harness-plugin-opencode/package.json");
    const binPath = resolve(dirname(pkgPath), binKey);
    return existsSync(binPath);
  } catch {
    return false;
  }
}

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
    expect(output).toContain("oc");
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
    // Worktree subcommands
    expect(output).toContain("new");
    expect(output).toContain("list");
    expect(output).toContain("switch");
    expect(output).toContain("delete");
    expect(output).toContain("cleanup");
  });

  test("glrs oc --help dispatches to harness-opencode (not redirect)", () => {
    if (!isCliBuilt() || !isHarnessBuilt()) {
      console.log("SKIP: cli or harness-opencode not built — run `bun run build` first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "oc", "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    expect(result.stderr ?? "").not.toContain(REDIRECT_SUBSTRING);
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    // harness-opencode help should mention its subcommands
    expect(output).toContain("install");
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
