/**
 * Tests that gs-agentic and gsag bins redirect when invoked standalone
 * and run normally when GLRS_CLI_DISPATCHED=1 is set.
 * Acceptance criterion a1 (agentic).
 */
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexJs = resolve(pkgDir, "dist/index.js");

const REDIRECT_SUBSTRING = "This binary is deprecated when invoked standalone.";

describe("agentic bin redirect", () => {
  test("gs-agentic bin redirects when GLRS_CLI_DISPATCHED unset", () => {
    const result = spawnSync(process.execPath, [indexJs], {
      env: { ...process.env, GLRS_CLI_DISPATCHED: undefined },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REDIRECT_SUBSTRING);
    expect(result.stderr).toContain("@glrs-dev/cli");
    expect(result.stderr).toContain("glrs.dev/install");
  });

  test("gsag bin redirects when GLRS_CLI_DISPATCHED unset", () => {
    // Both gs-agentic and gsag point to the same dist/index.js.
    // The redirect fires regardless of which bin name was used.
    const result = spawnSync(process.execPath, [indexJs], {
      env: { ...process.env, GLRS_CLI_DISPATCHED: undefined },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REDIRECT_SUBSTRING);
  });

  test("bin runs normally when GLRS_CLI_DISPATCHED=1", () => {
    const result = spawnSync(process.execPath, [indexJs, "--version"], {
      env: { ...process.env, GLRS_CLI_DISPATCHED: "1" },
      encoding: "utf8",
      timeout: 10000,
    });
    // Should NOT contain the redirect message
    expect(result.stderr ?? "").not.toContain(REDIRECT_SUBSTRING);
    // Should print version (gs-agentic <version>)
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toContain("gs-agentic");
  });
});
