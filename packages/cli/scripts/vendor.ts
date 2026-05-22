#!/usr/bin/env bun
/**
 * Vendor step for @glrs-dev/cli.
 *
 * Three vendor passes in strict order:
 *
 *   1. harness-opencode → dist/vendor/harness-opencode/
 *      The cli dispatcher resolves the subprocess bin from there (not from
 *      node_modules). This is a flat copy — the cli shells out to the bin,
 *      it does NOT import harness-opencode as an ESM module.
 *
 *   2. autopilot → dist/node_modules/@glrs-dev/autopilot/
 *      The cli imports autopilot as an ESM module at runtime. Placing it
 *      under dist/node_modules/ triggers Node's nested-module resolution:
 *      when dist/cli.js does `import "@glrs-dev/autopilot"`, Node walks up
 *      from dist/ and finds dist/node_modules/@glrs-dev/autopilot/ before
 *      falling through to the global install root.
 *
 *   3. adapter-opencode → dist/node_modules/@glrs-dev/adapter-opencode/
 *      Same mechanism as autopilot. The sibling autopilot vendor dir is
 *      what Node's resolver finds when adapter-opencode's bundle does
 *      `import "@glrs-dev/autopilot"`.
 *
 * The stripped package.json written for each vendored module contains only
 * name, version, type, main, module, types — no dependencies. This prevents
 * Node from looking for nested deps inside the vendored dirs (they resolve
 * against the cli's top-level dependencies at install time).
 */

import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const CLI_PKG_ROOT = resolve(import.meta.dir, "..");
const HARNESS_PKG_ROOT = resolve(CLI_PKG_ROOT, "..", "harness-opencode");
const AUTOPILOT_PKG_ROOT = resolve(CLI_PKG_ROOT, "..", "autopilot");
const ADAPTER_PKG_ROOT = resolve(CLI_PKG_ROOT, "..", "adapter-opencode");

const HARNESS_DIST = join(HARNESS_PKG_ROOT, "dist");
const HARNESS_PKG_JSON = join(HARNESS_PKG_ROOT, "package.json");
const VENDOR_HARNESS_DIR = join(CLI_PKG_ROOT, "dist", "vendor", "harness-opencode");

const AUTOPILOT_DIST = join(AUTOPILOT_PKG_ROOT, "dist");
const AUTOPILOT_PKG_JSON = join(AUTOPILOT_PKG_ROOT, "package.json");
const VENDOR_AUTOPILOT_DIR = join(CLI_PKG_ROOT, "dist", "node_modules", "@glrs-dev", "autopilot");

const ADAPTER_DIST = join(ADAPTER_PKG_ROOT, "dist");
const ADAPTER_PKG_JSON = join(ADAPTER_PKG_ROOT, "package.json");
const VENDOR_ADAPTER_DIR = join(CLI_PKG_ROOT, "dist", "node_modules", "@glrs-dev", "adapter-opencode");

function fail(msg: string): never {
  console.error(`[vendor] ${msg}`);
  process.exit(1);
}

// ─── Pass 1: harness-opencode ────────────────────────────────────────────────

if (!existsSync(HARNESS_DIST)) {
  fail(
    `harness-opencode dist/ missing at ${HARNESS_DIST}. ` +
      `Run 'bun run --filter=@glrs-dev/harness-plugin-opencode build' first.`,
  );
}
if (!existsSync(HARNESS_PKG_JSON)) {
  fail(`harness-opencode package.json missing at ${HARNESS_PKG_JSON}.`);
}

mkdirSync(VENDOR_HARNESS_DIR, { recursive: true });
cpSync(HARNESS_DIST, join(VENDOR_HARNESS_DIR, "dist"), { recursive: true });

const harnessPkg = JSON.parse(readFileSync(HARNESS_PKG_JSON, "utf8")) as Record<string, unknown>;
const vendoredHarness: Record<string, unknown> = {
  name: harnessPkg.name,
  version: harnessPkg.version,
  type: harnessPkg.type,
  main: harnessPkg.main,
  module: harnessPkg.module,
  bin: harnessPkg.bin,
};
writeFileSync(
  join(VENDOR_HARNESS_DIR, "package.json"),
  JSON.stringify(vendoredHarness, null, 2) + "\n",
);

const harnessFiles = listFiles(VENDOR_HARNESS_DIR);
const harnessBytes = harnessFiles.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(
  `[vendor] harness-opencode: ${harnessFiles.length} files (${formatBytes(harnessBytes)}) → dist/vendor/harness-opencode/`,
);

// ─── Pass 2: autopilot ───────────────────────────────────────────────────────

if (!existsSync(AUTOPILOT_DIST)) {
  fail(
    `autopilot dist/ missing at ${AUTOPILOT_DIST}. ` +
      `Run 'bun run --cwd packages/autopilot build' first.`,
  );
}
if (!existsSync(AUTOPILOT_PKG_JSON)) {
  fail(`autopilot package.json missing at ${AUTOPILOT_PKG_JSON}.`);
}

mkdirSync(VENDOR_AUTOPILOT_DIR, { recursive: true });
cpSync(AUTOPILOT_DIST, join(VENDOR_AUTOPILOT_DIR, "dist"), { recursive: true });

const autopilotPkg = JSON.parse(readFileSync(AUTOPILOT_PKG_JSON, "utf8")) as Record<string, unknown>;
const vendoredAutopilot: Record<string, unknown> = {
  name: autopilotPkg.name,
  version: autopilotPkg.version,
  type: autopilotPkg.type,
  main: "dist/index.js",
  module: "dist/index.js",
  types: "dist/index.d.ts",
};
writeFileSync(
  join(VENDOR_AUTOPILOT_DIR, "package.json"),
  JSON.stringify(vendoredAutopilot, null, 2) + "\n",
);

const autopilotFiles = listFiles(VENDOR_AUTOPILOT_DIR);
const autopilotBytes = autopilotFiles.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(
  `[vendor] autopilot: ${autopilotFiles.length} files (${formatBytes(autopilotBytes)}) → dist/node_modules/@glrs-dev/autopilot/`,
);

// ─── Pass 3: adapter-opencode ────────────────────────────────────────────────

if (!existsSync(ADAPTER_DIST)) {
  fail(
    `adapter-opencode dist/ missing at ${ADAPTER_DIST}. ` +
      `Run 'bun run --cwd packages/adapter-opencode build' first.`,
  );
}
if (!existsSync(ADAPTER_PKG_JSON)) {
  fail(`adapter-opencode package.json missing at ${ADAPTER_PKG_JSON}.`);
}

mkdirSync(VENDOR_ADAPTER_DIR, { recursive: true });
cpSync(ADAPTER_DIST, join(VENDOR_ADAPTER_DIR, "dist"), { recursive: true });

const adapterPkg = JSON.parse(readFileSync(ADAPTER_PKG_JSON, "utf8")) as Record<string, unknown>;
const vendoredAdapter: Record<string, unknown> = {
  name: adapterPkg.name,
  version: adapterPkg.version,
  type: adapterPkg.type,
  main: "dist/index.js",
  module: "dist/index.js",
  types: "dist/index.d.ts",
};
writeFileSync(
  join(VENDOR_ADAPTER_DIR, "package.json"),
  JSON.stringify(vendoredAdapter, null, 2) + "\n",
);

const adapterFiles = listFiles(VENDOR_ADAPTER_DIR);
const adapterBytes = adapterFiles.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(
  `[vendor] adapter-opencode: ${adapterFiles.length} files (${formatBytes(adapterBytes)}) → dist/node_modules/@glrs-dev/adapter-opencode/`,
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
