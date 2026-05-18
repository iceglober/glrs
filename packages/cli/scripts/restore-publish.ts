#!/usr/bin/env bun
/**
 * restore-publish — restore a package.json from the backup written by
 * prepare-publish.ts.
 *
 * Usage:
 *   bun scripts/restore-publish.ts [--pkg-path <path>]
 *
 * When --pkg-path is omitted, defaults to packages/cli/package.json.
 * The --pkg-path flag is used by tests to run against fixture files.
 *
 * Called by the release workflow after `bunx changeset publish` with
 * `if: always()` so it restores even on publish failure.
 *
 * Exits non-zero if the backup file does not exist (indicates the publish
 * flow ran out of order or prepare-publish was never called).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
  console.error(`[restore-publish] ${msg}`);
  process.exit(1);
}

if (!existsSync(BACKUP_PATH)) {
  fail(
    `Backup file not found at ${BACKUP_PATH}. ` +
      `Did prepare-publish run before this? Cannot restore.`,
  );
}

const backup = readFileSync(BACKUP_PATH, "utf8");
writeFileSync(PKG_JSON_PATH, backup);
unlinkSync(BACKUP_PATH);
console.log("[restore-publish] OK — package.json restored from backup.");
