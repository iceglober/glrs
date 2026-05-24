/**
 * vendor-layout.test.ts — assert that `bun run build` in packages/cli
 * produces the expected vendor layout:
 *
 *   dist/node_modules/@glrs-dev/autopilot/              (a1)
 *   dist/node_modules/@glrs-dev/adapter-opencode/       (a2)
 *   dist/node_modules/@glrs-dev/harness-plugin-opencode/ (a3)
 *   dist/node_modules/@glrs-dev/adapter-claude-code/    (a4)
 *
 * Requires the build to have run. beforeAll invokes the build and bails
 * if it fails.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { $ } from "bun";

const CLI_ROOT = resolve(import.meta.dir, "..");
const DIST = join(CLI_ROOT, "dist");

beforeAll(async () => {
  const result = await $`bun run build`.cwd(CLI_ROOT).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
    );
  }
}, 120_000);

// ─── a1: @glrs-dev/autopilot ─────────────────────────────────────────────────

describe("vendors @glrs-dev/autopilot under dist/node_modules", () => {
  const VENDOR_DIR = join(DIST, "node_modules", "@glrs-dev", "autopilot");

  it("directory exists", () => {
    expect(existsSync(VENDOR_DIR)).toBe(true);
  });

  it("package.json has correct name and main", () => {
    const pkgPath = join(VENDOR_DIR, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    expect(pkg.name).toBe("@glrs-dev/autopilot");
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.types).toBe("dist/index.d.ts");
  });

  it("dist/index.js exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "index.js"))).toBe(true);
  });

  it("dist/index.d.ts exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "index.d.ts"))).toBe(true);
  });

  it("package.json contains no workspace: references", () => {
    const pkg = JSON.parse(
      readFileSync(join(VENDOR_DIR, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | unknown>;
    const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const field of depFields) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const [name, value] of Object.entries(deps)) {
        expect(value, `${field}.${name} must not be a workspace: ref`).not.toMatch(/^workspace:/);
      }
    }
  });
});

// ─── a2: @glrs-dev/adapter-opencode ──────────────────────────────────────────

describe("vendors @glrs-dev/adapter-opencode under dist/node_modules", () => {
  const VENDOR_DIR = join(DIST, "node_modules", "@glrs-dev", "adapter-opencode");

  it("directory exists", () => {
    expect(existsSync(VENDOR_DIR)).toBe(true);
  });

  it("package.json has correct name and main", () => {
    const pkgPath = join(VENDOR_DIR, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    expect(pkg.name).toBe("@glrs-dev/adapter-opencode");
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.types).toBe("dist/index.d.ts");
  });

  it("dist/index.js exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "index.js"))).toBe(true);
  });

  it("dist/index.d.ts exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "index.d.ts"))).toBe(true);
  });

  it("package.json contains no workspace: references", () => {
    const pkg = JSON.parse(
      readFileSync(join(VENDOR_DIR, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | unknown>;
    const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const field of depFields) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const [name, value] of Object.entries(deps)) {
        expect(value, `${field}.${name} must not be a workspace: ref`).not.toMatch(/^workspace:/);
      }
    }
  });
});

// ─── a3: @glrs-dev/harness-plugin-opencode ──────────────────────────────────

describe("vendors @glrs-dev/harness-plugin-opencode under dist/node_modules", () => {
  const VENDOR_DIR = join(DIST, "node_modules", "@glrs-dev", "harness-plugin-opencode");

  it("directory exists", () => {
    expect(existsSync(VENDOR_DIR)).toBe(true);
  });

  it("package.json has correct name and exports", () => {
    const pkgPath = join(VENDOR_DIR, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    expect(pkg.name).toBe("@glrs-dev/harness-plugin-opencode");
    expect(pkg.exports).toBeDefined();
  });

  it("dist/index.js exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "index.js"))).toBe(true);
  });

  it("dist/cli-exports.js exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "cli-exports.js"))).toBe(true);
  });
});

// ─── a4: @glrs-dev/adapter-claude-code ──────────────────────────────────────

describe("vendors @glrs-dev/adapter-claude-code under dist/node_modules", () => {
  const VENDOR_DIR = join(DIST, "node_modules", "@glrs-dev", "adapter-claude-code");

  it("directory exists", () => {
    expect(existsSync(VENDOR_DIR)).toBe(true);
  });

  it("package.json has correct name and main", () => {
    const pkgPath = join(VENDOR_DIR, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    expect(pkg.name).toBe("@glrs-dev/adapter-claude-code");
    expect(pkg.main).toBe("dist/index.js");
  });

  it("dist/index.js exists", () => {
    expect(existsSync(join(VENDOR_DIR, "dist", "index.js"))).toBe(true);
  });
});
