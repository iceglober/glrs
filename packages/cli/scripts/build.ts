#!/usr/bin/env bun
/**
 * Build orchestrator for @glrs-dev/cli.
 *
 * Builds all internal packages, then bundles the CLI, then copies the
 * built outputs into dist/node_modules/ so they resolve at runtime.
 *
 * Steps (strict order):
 *   1. Build harness-opencode
 *   2. Build autopilot
 *   3. Build adapter-opencode
 *   4. Build adapter-claude-code
 *   5. Bundle the CLI itself (tsup)
 *   6. Copy internal packages into dist/node_modules/@glrs-dev/
 *
 * Sequential ordering prevents races (tsup --clean can wipe dist/ in
 * sibling packages while we're copying from them).
 */

import { $ } from "bun";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const CLI_ROOT = resolve(import.meta.dir, "..");
const HARNESS_ROOT = resolve(CLI_ROOT, "..", "harness-opencode");
const AUTOPILOT_ROOT = resolve(CLI_ROOT, "..", "autopilot");
const ADAPTER_ROOT = resolve(CLI_ROOT, "..", "adapter-opencode");
const ADAPTER_CC_ROOT = resolve(CLI_ROOT, "..", "adapter-claude-code");
const CLI_DIST = resolve(CLI_ROOT, "dist");

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n▸ ${name}`);
  const start = Date.now();
  await fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ✓ ${name} (${elapsed}s)`);
}

async function main(): Promise<void> {
  await step("Building @glrs-dev/harness-plugin-opencode", async () => {
    const result = await $`bun run build`.cwd(HARNESS_ROOT).nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `harness-opencode build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  await step("Building @glrs-dev/autopilot", async () => {
    const result = await $`bun run build`.cwd(AUTOPILOT_ROOT).nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `autopilot build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  await step("Building @glrs-dev/adapter-opencode", async () => {
    const result = await $`bun run build`.cwd(ADAPTER_ROOT).nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `adapter-opencode build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  await step("Building @glrs-dev/adapter-claude-code", async () => {
    const result = await $`bun run build`.cwd(ADAPTER_CC_ROOT).nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `adapter-claude-code build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  await step("Building @glrs-dev/cli", async () => {
    if (existsSync(CLI_DIST)) rmSync(CLI_DIST, { recursive: true });
    const result =
      await $`bunx tsup src/index.ts src/cli.ts src/lib/*.ts src/commands/*.ts --format esm --dts --clean --external cmd-ts --external @glrs-dev/autopilot --external @glrs-dev/adapter-opencode --external @glrs-dev/adapter-claude-code --external @glrs-dev/harness-plugin-opencode`
        .cwd(CLI_ROOT)
        .nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `cli tsup build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  await step("Copying internal packages into cli dist", async () => {
    const result = await $`bun scripts/vendor.ts`.cwd(CLI_ROOT).nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `vendor step failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  console.log("\n✓ All build steps complete.");
}

main().catch((err) => {
  console.error(`\n✗ Build failed: ${(err as Error).message}`);
  process.exit(1);
});
