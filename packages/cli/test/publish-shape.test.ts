/**
 * publish-shape.test.ts — acceptance tests for a4, a5, a6, a11.
 *
 * Tests the prepare-publish / restore-publish / verify-publishable pipeline
 * using fixture files in temp dirs (never touches the in-tree package.json
 * except in the tarball test which uses afterAll to restore).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const CLI_ROOT = resolve(import.meta.dir, "..");
const SCRIPTS_DIR = join(CLI_ROOT, "scripts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "glrs-publish-shape-"));
}

function writeFixture(dir: string, pkg: Record<string, unknown>): string {
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  return path;
}

async function runScript(
  scriptName: string,
  pkgPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await $`bun ${join(SCRIPTS_DIR, scriptName)} --pkg-path ${pkgPath}`
    .nothrow()
    .quiet();
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

// ─── a4: prepare-publish strips workspace: values ────────────────────────────

describe("prepare-publish strips workspace: values", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTmpDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("removes workspace: entries from dependencies", async () => {
    const pkgPath = writeFixture(tmpDir, {
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "@glrs-dev/autopilot": "workspace:*",
        "@glrs-dev/adapter-opencode": "workspace:*",
        "some-real-dep": "^1.0.0",
      },
    });

    const result = await runScript("prepare-publish.ts", pkgPath);
    expect(result.exitCode).toBe(0);

    const mutated = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
      string,
      Record<string, string>
    >;
    expect(mutated.dependencies["@glrs-dev/autopilot"]).toBeUndefined();
    expect(mutated.dependencies["@glrs-dev/adapter-opencode"]).toBeUndefined();
    expect(mutated.dependencies["some-real-dep"]).toBe("^1.0.0");

    // Cleanup backup
    const backupPath = pkgPath + ".publish-backup";
    if (existsSync(backupPath)) rmSync(backupPath);
  });

  it("removes workspace: entries from devDependencies", async () => {
    const dir2 = makeTmpDir();
    const pkgPath2 = writeFixture(dir2, {
      name: "test-pkg",
      version: "1.0.0",
      devDependencies: {
        "@glrs-dev/harness-plugin-opencode": "workspace:*",
        "typescript": "^5",
      },
    });

    const result = await runScript("prepare-publish.ts", pkgPath2);
    expect(result.exitCode).toBe(0);

    const mutated = JSON.parse(readFileSync(pkgPath2, "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    // workspace: entry must be gone; typescript (concrete range) must survive
    if (mutated.devDependencies) {
      expect(mutated.devDependencies["@glrs-dev/harness-plugin-opencode"]).toBeUndefined();
      expect(mutated.devDependencies["typescript"]).toBe("^5");
    }

    rmSync(dir2, { recursive: true, force: true });
  });
});

// ─── a4: prepare-publish leaves concrete semver ranges intact ────────────────

describe("prepare-publish leaves concrete semver ranges intact", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTmpDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("leaves ^semver ranges untouched", async () => {
    const pkgPath = writeFixture(tmpDir, {
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "@glrs-dev/harness-plugin-opencode": "^2.4.1",
        "@glrs-dev/autopilot": "workspace:*",
      },
    });

    const result = await runScript("prepare-publish.ts", pkgPath);
    expect(result.exitCode).toBe(0);

    const mutated = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
      string,
      Record<string, string>
    >;
    // Concrete semver range must survive
    expect(mutated.dependencies["@glrs-dev/harness-plugin-opencode"]).toBe("^2.4.1");
    // workspace: ref must be gone
    expect(mutated.dependencies["@glrs-dev/autopilot"]).toBeUndefined();

    const backupPath = pkgPath + ".publish-backup";
    if (existsSync(backupPath)) rmSync(backupPath);
  });
});

// ─── a11: prepare + restore round-trip is byte-identical ─────────────────────

describe("prepare + restore round-trip is byte-identical", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTmpDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("restores the original file byte-for-byte and removes the backup", async () => {
    const original = JSON.stringify(
      {
        name: "test-pkg",
        version: "1.0.0",
        dependencies: {
          "@glrs-dev/autopilot": "workspace:*",
          "some-dep": "^1.0.0",
        },
      },
      null,
      2,
    ) + "\n";

    const pkgPath = join(tmpDir, "package.json");
    writeFileSync(pkgPath, original);

    // prepare
    const prepResult = await runScript("prepare-publish.ts", pkgPath);
    expect(prepResult.exitCode).toBe(0);

    const backupPath = pkgPath + ".publish-backup";
    expect(existsSync(backupPath)).toBe(true);

    // restore
    const restoreResult = await runScript("restore-publish.ts", pkgPath);
    expect(restoreResult.exitCode).toBe(0);

    // backup must be gone
    expect(existsSync(backupPath)).toBe(false);

    // file must be byte-identical to original
    const restored = readFileSync(pkgPath, "utf8");
    expect(restored).toBe(original);
  });
});

// ─── a5: verify-publishable fails on workspace: refs ─────────────────────────

describe("verify-publishable fails on workspace: refs", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTmpDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits non-zero and prints FAIL when workspace: refs present", async () => {
    const pkgPath = writeFixture(tmpDir, {
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "@glrs-dev/autopilot": "workspace:*",
      },
    });

    const result = await runScript("verify-publishable.ts", pkgPath);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("FAIL");
  });
});

// ─── a5: verify-publishable passes on a clean package.json ───────────────────

describe("verify-publishable passes on a clean package.json", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTmpDir();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits zero when no workspace: refs present", async () => {
    const pkgPath = writeFixture(tmpDir, {
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "some-dep": "^1.0.0",
        "@glrs-dev/harness-plugin-opencode": "^2.4.1",
      },
    });

    const result = await runScript("verify-publishable.ts", pkgPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK");
  });
});

// ─── a6: packed tarball contains vendored deps and no workspace: refs ─────────

describe("packed tarball contains vendored deps and no workspace: refs", () => {
  let packDir: string;
  let tarballPath: string;
  let extractDir: string;

  beforeAll(async () => {
    // Build first
    const buildResult = await $`bun run build`.cwd(CLI_ROOT).nothrow();
    if (buildResult.exitCode !== 0) {
      throw new Error(`Build failed:\n${buildResult.stderr.toString()}`);
    }

    // prepare-publish (mutates in-tree package.json)
    const prepResult = await $`bun run prepare-publish`.cwd(CLI_ROOT).nothrow();
    if (prepResult.exitCode !== 0) {
      throw new Error(`prepare-publish failed:\n${prepResult.stderr.toString()}`);
    }

    // Pack using npm pack (bun pm pack excludes node_modules/ dirs even when
    // listed in the files field; npm pack respects the files field correctly).
    packDir = makeTmpDir();
    const packResult = await $`npm pack --pack-destination ${packDir}`.cwd(CLI_ROOT).nothrow();
    if (packResult.exitCode !== 0) {
      // Restore before throwing
      await $`bun run restore-publish`.cwd(CLI_ROOT).nothrow();
      throw new Error(`npm pack failed:\n${packResult.stderr.toString()}`);
    }

    // Find the tarball
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
    if (files.length === 0) {
      await $`bun run restore-publish`.cwd(CLI_ROOT).nothrow();
      throw new Error(`No .tgz found in ${packDir}`);
    }
    tarballPath = join(packDir, files[0]);

    // Extract
    extractDir = makeTmpDir();
    const extractResult = await $`tar -xzf ${tarballPath} -C ${extractDir}`.nothrow();
    if (extractResult.exitCode !== 0) {
      await $`bun run restore-publish`.cwd(CLI_ROOT).nothrow();
      throw new Error(`tar extraction failed:\n${extractResult.stderr.toString()}`);
    }

    // Restore in-tree package.json
    await $`bun run restore-publish`.cwd(CLI_ROOT).nothrow();
  }, 180_000);

  afterAll(() => {
    if (packDir) rmSync(packDir, { recursive: true, force: true });
    if (extractDir) rmSync(extractDir, { recursive: true, force: true });
    // Safety: ensure restore ran (idempotent — restore-publish exits non-zero if no backup)
    const backupPath = join(CLI_ROOT, "package.json.publish-backup");
    if (existsSync(backupPath)) {
      // Synchronous restore
      const { readFileSync: rfs, writeFileSync: wfs, unlinkSync } = require("node:fs");
      wfs(join(CLI_ROOT, "package.json"), rfs(backupPath, "utf8"));
      unlinkSync(backupPath);
    }
  });

  it("extracted package/package.json contains no workspace: refs", () => {
    const pkgPath = join(extractDir, "package", "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const content = readFileSync(pkgPath, "utf8");
    expect(content).not.toMatch(/workspace:/);
  });

  it("extracted package contains dist/node_modules/@glrs-dev/autopilot/dist/index.js", () => {
    const p = join(
      extractDir,
      "package",
      "dist",
      "node_modules",
      "@glrs-dev",
      "autopilot",
      "dist",
      "index.js",
    );
    expect(existsSync(p)).toBe(true);
  });

  it("extracted package contains dist/node_modules/@glrs-dev/adapter-opencode/dist/index.js", () => {
    const p = join(
      extractDir,
      "package",
      "dist",
      "node_modules",
      "@glrs-dev",
      "adapter-opencode",
      "dist",
      "index.js",
    );
    expect(existsSync(p)).toBe(true);
  });

  it("extracted package contains dist/node_modules/@glrs-dev/harness-plugin-opencode/dist/cli-exports.js", () => {
    const p = join(
      extractDir,
      "package",
      "dist",
      "node_modules",
      "@glrs-dev",
      "harness-plugin-opencode",
      "dist",
      "cli-exports.js",
    );
    expect(existsSync(p)).toBe(true);
  });
});
