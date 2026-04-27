#!/usr/bin/env bun
/**
 * Vendor harness-opencode's build output into the cli package so the
 * published @glrs-dev/cli tarball is self-contained.
 *
 * Why: @glrs-dev/harness-opencode is marked `private: true` and will
 * never publish to npm again. But cli's `glrs oc` subcommand needs to
 * spawn it. Solution: copy packages/harness-opencode/dist/ into
 * packages/cli/dist/vendor/harness-opencode/ at build time. The cli's
 * dispatcher resolves the bin from there, not from node_modules.
 *
 * Runs as the `build` script's second step in packages/cli/package.json.
 */

import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const CLI_PKG_ROOT = resolve(import.meta.dir, "..");
const HARNESS_PKG_ROOT = resolve(CLI_PKG_ROOT, "..", "harness-opencode");
const HARNESS_DIST = join(HARNESS_PKG_ROOT, "dist");
const HARNESS_PKG_JSON = join(HARNESS_PKG_ROOT, "package.json");
const VENDOR_DIR = join(CLI_PKG_ROOT, "dist", "vendor", "harness-opencode");

function fail(msg: string): never {
  console.error(`[vendor-harness] ${msg}`);
  process.exit(1);
}

if (!existsSync(HARNESS_DIST)) {
  fail(
    `harness-opencode dist/ missing at ${HARNESS_DIST}. ` +
      `Run 'bun run --filter=@glrs-dev/harness-opencode build' first.`,
  );
}
if (!existsSync(HARNESS_PKG_JSON)) {
  fail(`harness-opencode package.json missing at ${HARNESS_PKG_JSON}.`);
}

// Clear existing vendor dir and recreate
mkdirSync(VENDOR_DIR, { recursive: true });

// Recursively copy the entire dist/ tree, preserving structure.
// Node's cpSync (20+) handles this in one call.
cpSync(HARNESS_DIST, join(VENDOR_DIR, "dist"), { recursive: true });

// Copy the package.json so the cli dispatcher can read the `bin` field
// to resolve the entrypoint. Strip `dependencies` — those are declared
// in cli's package.json; we don't want the vendored package.json to
// confuse `require.resolve` or any downstream tooling.
const harnessPkg = JSON.parse(readFileSync(HARNESS_PKG_JSON, "utf8")) as Record<
  string,
  unknown
>;
const vendored: Record<string, unknown> = {
  name: harnessPkg.name,
  version: harnessPkg.version,
  type: harnessPkg.type,
  main: harnessPkg.main,
  module: harnessPkg.module,
  bin: harnessPkg.bin,
};
writeFileSync(
  join(VENDOR_DIR, "package.json"),
  JSON.stringify(vendored, null, 2) + "\n",
);

// Report what we vendored
const files = listFiles(VENDOR_DIR);
const totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(
  `[vendor-harness] vendored ${files.length} files (${formatBytes(totalBytes)}) → dist/vendor/harness-opencode/`,
);

function listFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(full));
    } else {
      result.push(full);
    }
  }
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
