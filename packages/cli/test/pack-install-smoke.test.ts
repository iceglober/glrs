/**
 * pack-install-smoke.test.ts — acceptance test for a7.
 *
 * Gated by GLRS_SKIP_SMOKE: skipped when the env var is set to a truthy
 * value. Invoke with `GLRS_SKIP_SMOKE= bun test ...` (empty string = falsy)
 * to force-run.
 *
 * Test flow:
 *   1. Build + prepare-publish + pack into a temp dir.
 *   2. Install the tarball into a fresh temp dir under os.tmpdir() (NOT
 *      under the repo, to avoid inheriting the monorepo's bun-workspace
 *      config via upward lookup).
 *   3. Assert glrs --version exits 0 with semver-shaped stdout.
 *   4. Assert glrs autopilot --help exits 0 with no MODULE_NOT_FOUND.
 *   5. Assert require.resolve('@glrs-dev/autopilot') walks into
 *      cli's dist/node_modules/ (proves nested resolution works).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { readdirSync } from "node:fs";

const CLI_ROOT = resolve(import.meta.dir, "..");

// ─── Gate ────────────────────────────────────────────────────────────────────

const SKIP_SMOKE =
  process.env.GLRS_SKIP_SMOKE !== undefined &&
  process.env.GLRS_SKIP_SMOKE !== "" &&
  process.env.GLRS_SKIP_SMOKE !== "0";

// ─── Shared state ────────────────────────────────────────────────────────────

let packDir: string;
let tarballPath: string;
let installDir: string;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe.if(!SKIP_SMOKE)("pack-install smoke", () => {
  beforeAll(async () => {
    // Build
    const buildResult = await $`bun run build`.cwd(CLI_ROOT).nothrow();
    if (buildResult.exitCode !== 0) {
      throw new Error(`Build failed:\n${buildResult.stderr.toString()}`);
    }

    // prepare-publish
    const prepResult = await $`bun run prepare-publish`.cwd(CLI_ROOT).nothrow();
    if (prepResult.exitCode !== 0) {
      throw new Error(`prepare-publish failed:\n${prepResult.stderr.toString()}`);
    }

    // Pack using npm pack (bun pm pack excludes node_modules/ dirs even when
    // listed in the files field; npm pack respects the files field correctly).
    packDir = mkdtempSync(join(tmpdir(), "glrs-cli-smoke-pack-"));
    const packResult = await $`npm pack --pack-destination ${packDir}`.cwd(CLI_ROOT).nothrow();

    // Restore in-tree package.json before any potential throw
    await $`bun run restore-publish`.cwd(CLI_ROOT).nothrow();

    if (packResult.exitCode !== 0) {
      throw new Error(`npm pack failed:\n${packResult.stderr.toString()}`);
    }

    // Find the tarball
    const files = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
    if (files.length === 0) {
      throw new Error(`No .tgz found in ${packDir}`);
    }
    tarballPath = join(packDir, files[0]);

    // Create install dir under os.tmpdir() — NOT under the repo
    installDir = mkdtempSync(join(tmpdir(), "glrs-cli-smoke-install-"));

    // Write a minimal package.json directly (do NOT run bun init)
    writeFileSync(
      join(installDir, "package.json"),
      JSON.stringify({ name: "smoke-test", version: "0.0.0", private: true }, null, 2) + "\n",
    );

    // Install the tarball
    const installResult = await $`bun add file:${tarballPath}`.cwd(installDir).nothrow();
    if (installResult.exitCode !== 0) {
      throw new Error(
        `bun add failed:\n${installResult.stdout.toString()}\n${installResult.stderr.toString()}`,
      );
    }
  }, 180_000);

  afterAll(() => {
    if (packDir && existsSync(packDir)) rmSync(packDir, { recursive: true, force: true });
    if (installDir && existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
    // Safety: ensure restore ran
    const backupPath = join(CLI_ROOT, "package.json.publish-backup");
    if (existsSync(backupPath)) {
      const { readFileSync, writeFileSync: wfs, unlinkSync } = require("node:fs");
      wfs(join(CLI_ROOT, "package.json"), readFileSync(backupPath, "utf8"));
      unlinkSync(backupPath);
    }
  });

  it("installed glrs --version exits zero with semver-shaped stdout", async () => {
    const binPath = join(installDir, "node_modules", ".bin", "glrs");
    expect(existsSync(binPath)).toBe(true);

    const result = await $`${binPath} --version`.nothrow().quiet();
    expect(result.exitCode).toBe(0);
    // Output is "glrs 2.4.0" — match semver anywhere in the output
    expect(result.stdout.toString().trim()).toMatch(/\d+\.\d+\.\d+/);
  }, 30_000);

  it("installed glrs autopilot --help loads without MODULE_NOT_FOUND", async () => {
    const binPath = join(installDir, "node_modules", ".bin", "glrs");
    const result = await $`${binPath} autopilot --help`.nothrow().quiet();

    const combined = result.stdout.toString() + result.stderr.toString();
    // The command may exit non-zero (e.g., "requires a TTY") but must NOT
    // fail with a module resolution error.
    expect(combined).not.toContain("MODULE_NOT_FOUND");
    expect(combined).not.toContain("Cannot find module");
  }, 30_000);

  it("@glrs-dev/autopilot resolves into cli's dist/node_modules", async () => {
    const cliDistPath = join(installDir, "node_modules", "@glrs-dev", "cli", "dist");
    const script = `console.log(require.resolve('@glrs-dev/autopilot', { paths: [${JSON.stringify(cliDistPath)}] }))`;

    const result = await $`node -e ${script}`.nothrow().quiet();
    expect(result.exitCode).toBe(0);

    const resolved = result.stdout.toString().trim();
    // Normalize both paths through realpathSync to handle macOS /private symlink
    const { realpathSync } = await import("node:fs");
    const expectedPrefix = realpathSync(
      join(installDir, "node_modules", "@glrs-dev", "cli", "dist", "node_modules"),
    );
    const resolvedReal = realpathSync(resolved);
    expect(resolvedReal.startsWith(expectedPrefix)).toBe(true);
  }, 30_000);
});
