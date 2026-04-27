#!/usr/bin/env node
/**
 * scripts/pack-platform-tarballs.mjs
 *
 * Copy the binaries produced by the rust-build-matrix workflow into each
 * platform package's bin/ directory, so `bun publish` picks them up.
 *
 * Input layout (from the release workflow's artifact-download step):
 *   packages/assume/.release-artifacts/darwin-arm64/gs-assume
 *   packages/assume/.release-artifacts/darwin-arm64/gsa
 *   packages/assume/.release-artifacts/darwin-x64/gs-assume
 *   ...
 *   packages/assume/.release-artifacts/win32-x64/gs-assume.exe
 *   packages/assume/.release-artifacts/win32-x64/gsa.exe
 *
 * Output layout:
 *   packages/assume/npm/darwin-arm64/bin/gs-assume  (mode 0o755)
 *   packages/assume/npm/darwin-arm64/bin/gsa        (mode 0o755)
 *   ...
 *   packages/assume/npm/win32-x64/bin/gs-assume.exe
 *   packages/assume/npm/win32-x64/bin/gsa.exe
 *
 * Note: the platform package.json files do NOT list bins — we don't want
 * npm to symlink them. The parent @glrs-dev/assume shim (src/cli.ts)
 * resolves the binary via require.resolve and spawns it directly.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");
const artifactsDir = resolve(pkgDir, ".release-artifacts");

if (!existsSync(artifactsDir)) {
  console.error(
    `[pack-platforms] No artifacts found at ${artifactsDir}. ` +
      `The release workflow's download-artifact step must run before this script.`,
  );
  process.exit(1);
}

const platforms = [
  { key: "darwin-arm64", exe: false },
  { key: "darwin-x64", exe: false },
  { key: "linux-x64", exe: false },
  { key: "linux-arm64", exe: false },
  { key: "win32-x64", exe: true },
];

let errors = 0;
for (const { key, exe } of platforms) {
  const srcDir = resolve(artifactsDir, key);
  const destDir = resolve(pkgDir, "npm", key, "bin");

  if (!existsSync(srcDir)) {
    console.error(`[pack-platforms] ✗ Missing artifact dir: ${srcDir}`);
    errors++;
    continue;
  }

  mkdirSync(destDir, { recursive: true });

  const suffix = exe ? ".exe" : "";
  for (const bin of ["gs-assume", "gsa"]) {
    const srcBin = resolve(srcDir, `${bin}${suffix}`);
    const destBin = resolve(destDir, `${bin}${suffix}`);
    if (!existsSync(srcBin)) {
      console.error(`[pack-platforms] ✗ Missing binary: ${srcBin}`);
      errors++;
      continue;
    }
    copyFileSync(srcBin, destBin);
    if (!exe) chmodSync(destBin, 0o755);
    console.log(`[pack-platforms] ✓ ${key}/bin/${bin}${suffix}`);
  }
}

if (errors > 0) {
  console.error(`[pack-platforms] Failed with ${errors} missing artifacts.`);
  process.exit(1);
}

console.log(`[pack-platforms] Done.`);
