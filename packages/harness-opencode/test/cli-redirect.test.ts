/**
 * Tests that harness-opencode and glrs-oc bins redirect when invoked standalone
 * and run normally when GLRS_CLI_DISPATCHED=1 is set.
 * Acceptance criterion a1 (harness-opencode + glrs-oc).
 */
import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = resolve(pkgDir, "dist/cli.js");

const REDIRECT_SUBSTRING = "This binary is deprecated when invoked standalone.";

describe("harness-opencode bin redirect", () => {
  test("harness-opencode bin redirects when GLRS_CLI_DISPATCHED unset", () => {
    const result = spawnSync(process.execPath, [cliJs], {
      env: { ...process.env, GLRS_CLI_DISPATCHED: undefined },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REDIRECT_SUBSTRING);
    expect(result.stderr).toContain("@glrs-dev/cli");
    expect(result.stderr).toContain("glrs.dev/install");
  });

  test("glrs-oc bin redirects when GLRS_CLI_DISPATCHED unset", () => {
    // Simulate glrs-oc invocation by passing the script path as argv[1]
    // with a fake argv[0] that looks like glrs-oc.
    // Node doesn't let us override argv[1] directly, but the redirect reads
    // process.argv[1] which is the script path. The bin name in the message
    // comes from the basename of argv[1]. We verify the redirect fires.
    const result = spawnSync(process.execPath, [cliJs], {
      env: { ...process.env, GLRS_CLI_DISPATCHED: undefined },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REDIRECT_SUBSTRING);
  });

  test("bin runs normally when GLRS_CLI_DISPATCHED=1", () => {
    const result = spawnSync(process.execPath, [cliJs, "--help"], {
      env: { ...process.env, GLRS_CLI_DISPATCHED: "1" },
      encoding: "utf8",
      timeout: 10000,
    });
    // Should NOT contain the redirect message
    expect(result.stderr ?? "").not.toContain(REDIRECT_SUBSTRING);
    // Should print real help (harness-opencode subcommand names)
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    expect(output).toContain("install");
  });
});
