#!/usr/bin/env bun
/**
 * verify-publishable — assert that a package.json contains no workspace:*
 * references in any dependency field.
 *
 * Usage:
 *   bun scripts/verify-publishable.ts [--pkg-path <path>]
 *
 * When --pkg-path is omitted, defaults to packages/cli/package.json.
 * The --pkg-path flag is used by tests to run against fixture files.
 *
 * Exits 1 with a descriptive error if any violation is found.
 * Exits 0 with "[verify-publishable] OK" if clean.
 *
 * Wired as a step in .github/workflows/release.yml immediately after
 * prepare-publish, so any future regression breaks CI before it breaks npm.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dir, "..");

// Parse optional --pkg-path argument
let PKG_JSON_PATH = resolve(PKG_ROOT, "package.json");
const args = process.argv.slice(2);
const pkgPathIdx = args.indexOf("--pkg-path");
if (pkgPathIdx !== -1 && args[pkgPathIdx + 1]) {
  PKG_JSON_PATH = resolve(args[pkgPathIdx + 1]);
}

const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, "utf8")) as Record<string, unknown>;

const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const violations: string[] = [];

for (const field of depFields) {
  const deps = pkg[field] as Record<string, string> | undefined;
  if (!deps) continue;
  for (const [name, value] of Object.entries(deps)) {
    if (value.startsWith("workspace:")) {
      violations.push(`  ${field}.${name} = "${value}"`);
    }
  }
}

if (violations.length > 0) {
  console.error("[verify-publishable] FAIL: workspace: references found:");
  for (const v of violations) {
    console.error(v);
  }
  process.exit(1);
}

console.log("[verify-publishable] OK");
