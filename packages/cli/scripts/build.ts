#!/usr/bin/env bun
/**
 * Build orchestrator for @glrs-dev/cli.
 *
 * Runs three steps in strict order:
 *   1. Build harness-opencode (sibling workspace package we vendor).
 *   2. Build cli itself (tsup bundle + DTS).
 *   3. Vendor harness-opencode's dist/ into cli/dist/vendor/.
 *
 * We do this in one script rather than spreading across npm scripts
 * because Bun's `--filter` at the top level runs packages in parallel,
 * which creates a race: harness-opencode's tsup --clean can wipe its
 * dist/ *after* cli's vendor step has already copied from it. Owning
 * the ordering inside cli's build script makes it deterministic.
 *
 * Idempotent: repeated invocations produce the same result.
 */

import { $ } from "bun";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const CLI_ROOT = resolve(import.meta.dir, "..");
const HARNESS_ROOT = resolve(CLI_ROOT, "..", "harness-opencode");
const CLI_DIST = resolve(CLI_ROOT, "dist");

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n▸ ${name}`);
  const start = Date.now();
  await fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  ✓ ${name} (${elapsed}s)`);
}

async function main(): Promise<void> {
  // Step 1: harness-opencode build
  await step("Building @glrs-dev/harness-plugin-opencode", async () => {
    const result = await $`bun run build`.cwd(HARNESS_ROOT).nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `harness-opencode build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  // Step 2: cli tsup build
  await step("Building @glrs-dev/cli", async () => {
    // tsup --clean wipes dist/, so remove manually first for predictability
    if (existsSync(CLI_DIST)) rmSync(CLI_DIST, { recursive: true });
    const result =
      await $`bunx tsup src/index.ts src/cli.ts src/lib/*.ts src/commands/*.ts --format esm --dts --clean --external cmd-ts`
        .cwd(CLI_ROOT)
        .nothrow();
    if (result.exitCode !== 0) {
      throw new Error(
        `cli tsup build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
      );
    }
  });

  // Step 3: vendor harness-opencode into cli
  await step("Vendoring harness-opencode into cli", async () => {
    const result = await $`bun scripts/vendor-harness.ts`.cwd(CLI_ROOT).nothrow();
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
