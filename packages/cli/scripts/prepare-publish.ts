#!/usr/bin/env bun
/**
 * prepare-publish — strip workspace:* references from a package.json
 * before publishing to npm.
 *
 * Usage:
 *   bun scripts/prepare-publish.ts [--pkg-path <path>]
 *
 * When --pkg-path is omitted, defaults to packages/cli/package.json
 * (the in-tree file). The --pkg-path flag is used by tests to run
 * against fixture files without touching the real package.json.
 *
 * Writes a backup to <pkg-path>.publish-backup so restore-publish.ts
 * can recover the original file even if the publish step crashes.
 *
 * Exits non-zero if:
 *   - The backup file already exists (stale backup from a previous failed run).
 *   - The package.json cannot be read or parsed.
 *
 * Strip predicate: value.startsWith('workspace:')
 * This is intentionally narrow — it leaves concrete semver ranges (like
 * "^2.4.1", which changesets writes during the Version PR run) untouched.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dir, "..");

// Parse optional --pkg-path argument
let PKG_JSON_PATH = resolve(PKG_ROOT, "package.json");
const args = process.argv.slice(2);
const pkgPathIdx = args.indexOf("--pkg-path");
if (pkgPathIdx !== -1 && args[pkgPathIdx + 1]) {
  PKG_JSON_PATH = resolve(args[pkgPathIdx + 1]);
}

const BACKUP_PATH = PKG_JSON_PATH + ".publish-backup";

function fail(msg: string): never {
  console.error(`[prepare-publish] ${msg}`);
  process.exit(1);
}

if (existsSync(BACKUP_PATH)) {
  fail(
    `Backup file already exists at ${BACKUP_PATH}. ` +
      `A previous prepare-publish run may not have been restored. ` +
      `Run 'bun run restore-publish' to recover, then retry.`,
  );
}

const raw = readFileSync(PKG_JSON_PATH, "utf8");
const pkg = JSON.parse(raw) as Record<string, unknown>;

// Write backup before mutating
writeFileSync(BACKUP_PATH, raw);

// Strip workspace:* values from all dep fields
const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
let stripped = 0;

for (const field of depFields) {
  const deps = pkg[field] as Record<string, string> | undefined;
  if (!deps) continue;
  for (const [name, value] of Object.entries(deps)) {
    if (value.startsWith("workspace:")) {
      delete deps[name];
      stripped++;
      console.log(`[prepare-publish] stripped ${field}.${name} = "${value}"`);
    }
  }
  // Remove the field entirely if it's now empty
  if (Object.keys(deps).length === 0) {
    delete pkg[field];
  }
}

writeFileSync(PKG_JSON_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[prepare-publish] OK — stripped ${stripped} workspace: reference(s).`);
