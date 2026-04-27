/**
 * Tests that `glrs oc --help`, `glrs agentic --help`, and `glrs assume --help`
 * dispatch to the real underlying tools (not the redirect).
 * Acceptance criterion a2.
 *
 * Prerequisites: all downstream packages must be built before this test runs.
 * The verify command in the plan sequences builds before running this test.
 * For the assume subcommand, the native Rust binary must be built and placed
 * at the expected platform path (see the plan's a2 verify command).
 *
 * Tests skip gracefully when binaries are missing.
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
    const pkgJson = req("@glrs-dev/harness-opencode/package.json") as {
      bin?: Record<string, string>;
    };
    const binKey = pkgJson.bin?.["harness-opencode"];
    if (!binKey) return false;
    const pkgPath = req.resolve("@glrs-dev/harness-opencode/package.json");
    const binPath = resolve(dirname(pkgPath), binKey);
    return existsSync(binPath);
  } catch {
    return false;
  }
}

function isAgenticBuilt(): boolean {
  try {
    const pkgJson = req("@glrs-dev/agentic/package.json") as {
      bin?: Record<string, string>;
    };
    const binKey = pkgJson.bin?.["gs-agentic"];
    if (!binKey) return false;
    const pkgPath = req.resolve("@glrs-dev/agentic/package.json");
    const binPath = resolve(dirname(pkgPath), binKey);
    return existsSync(binPath);
  } catch {
    return false;
  }
}

function isAssumeBuilt(): boolean {
  try {
    const assume = req("@glrs-dev/assume") as { getBinaryPath: () => string };
    const binPath = assume.getBinaryPath();
    return existsSync(binPath);
  } catch {
    return false;
  }
}

describe("glrs dispatch passthrough", () => {
  test("glrs oc --help prints harness-opencode help, not redirect", () => {
    if (!isHarnessBuilt()) {
      console.log("SKIP: harness-opencode not built — run `cd packages/harness-opencode && bun run build` first");
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

  test("glrs agentic --help prints gs-agentic help, not redirect", () => {
    if (!isAgenticBuilt()) {
      console.log("SKIP: agentic not built — run `cd packages/agentic && bun run build` first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "agentic", "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    expect(result.stderr ?? "").not.toContain(REDIRECT_SUBSTRING);
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    // gs-agentic help should mention its subcommands
    expect(output).toContain("gs-agentic");
  });

  test("glrs assume --help prints gs-assume help, not redirect", () => {
    if (!isAssumeBuilt()) {
      console.log("SKIP: assume native binary not built — run `cd packages/assume && cargo build --release` and copy binary to npm/<platform>/bin/ first");
      return;
    }
    const result = spawnSync(process.execPath, [cliJs, "assume", "--help"], {
      encoding: "utf8",
      timeout: 15000,
    });
    expect(result.stderr ?? "").not.toContain(REDIRECT_SUBSTRING);
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    // gs-assume help should mention credential management
    expect(output).toContain("credential");
  });
});
