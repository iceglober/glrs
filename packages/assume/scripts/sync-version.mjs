#!/usr/bin/env node
/**
 * scripts/sync-version.mjs
 *
 * After `changeset version` bumps the npm packages, this script reads the
 * canonical version from @glrs-dev/assume's package.json and propagates it to:
 *
 *   - Cargo.toml (for crates.io publishing)
 *   - npm/<platform>/package.json × 5
 *   - optionalDependencies in @glrs-dev/assume's package.json
 *
 * This keeps all six npm packages + the Rust crate in lockstep, which is
 * required for the optional-deps pattern to resolve correctly.
 *
 * Invoked by the release workflow after `bunx changeset version` but before
 * `changeset publish`. Can also be run manually when bumping Cargo-side
 * independently (which should be rare; the Changesets `linked` group is the
 * source of truth).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");

const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
];

const mainPkgPath = resolve(pkgDir, "package.json");
const mainPkg = JSON.parse(readFileSync(mainPkgPath, "utf8"));
const version = mainPkg.version;

if (!version || version === "0.0.0") {
  console.error(
    `[sync-version] Refusing to sync: @glrs-dev/assume version is '${version}'. ` +
      `This usually means Changesets hasn't run yet. Run 'bunx changeset version' first.`,
  );
  process.exit(1);
}

console.log(`[sync-version] Syncing all targets to version ${version}`);

// 1. Update platform package.jsons
for (const plat of platforms) {
  const platPkgPath = resolve(pkgDir, "npm", plat, "package.json");
  const platPkg = JSON.parse(readFileSync(platPkgPath, "utf8"));
  platPkg.version = version;
  writeFileSync(platPkgPath, JSON.stringify(platPkg, null, 2) + "\n");
  console.log(`[sync-version]   ✓ npm/${plat}/package.json → ${version}`);
}

// 2. Update optionalDependencies in main package.json
mainPkg.optionalDependencies = mainPkg.optionalDependencies ?? {};
for (const plat of platforms) {
  mainPkg.optionalDependencies[`@glrs-dev/assume-${plat}`] = version;
}
writeFileSync(mainPkgPath, JSON.stringify(mainPkg, null, 2) + "\n");
console.log(`[sync-version]   ✓ package.json optionalDependencies → ${version}`);

// 3. Update Cargo.toml
const cargoPath = resolve(pkgDir, "Cargo.toml");
const cargoRaw = readFileSync(cargoPath, "utf8");
// Match the top-level [package] version line. Must come before any other
// [package.foo] subsection or [dependencies.xxx] table key named 'version'.
const cargoUpdated = cargoRaw.replace(
  /^version = "[^"]+"/m,
  `version = "${version}"`,
);
if (cargoUpdated === cargoRaw) {
  console.error(
    `[sync-version] Failed to find 'version = "..."' line in Cargo.toml`,
  );
  process.exit(1);
}
writeFileSync(cargoPath, cargoUpdated);
console.log(`[sync-version]   ✓ Cargo.toml → ${version}`);

console.log(`[sync-version] Done.`);
