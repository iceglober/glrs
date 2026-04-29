#!/usr/bin/env node
/**
 * scripts/sync-version.test.mjs
 *
 * Unit tests for sync-version.mjs. Creates temporary fixtures and verifies
 * the script propagates versions correctly.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const scriptPath = resolve(import.meta.dirname, "sync-version.mjs");

function createFixture() {
  const tempDir = mkdtempSync(resolve(tmpdir(), "sync-version-test-"));

  // Main package.json at version 9.9.9-test
  const mainPkg = {
    name: "@glrs-dev/assume",
    version: "9.9.9-test",
    optionalDependencies: {},
  };
  writeFileSync(resolve(tempDir, "package.json"), JSON.stringify(mainPkg, null, 2) + "\n");

  // Create npm platform directories with package.json at 0.0.0
  const platforms = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"];
  for (const plat of platforms) {
    const platDir = resolve(tempDir, "npm", plat);
    mkdirSync(platDir, { recursive: true });
    const platPkg = {
      name: `@glrs-dev/assume-${plat}`,
      version: "0.0.0",
    };
    writeFileSync(resolve(platDir, "package.json"), JSON.stringify(platPkg, null, 2) + "\n");
  }

  // Cargo.toml at version 0.0.0
  const cargoToml = `[package]
name = "glrs-assume"
version = "0.0.0"
edition = "2021"
`;
  writeFileSync(resolve(tempDir, "Cargo.toml"), cargoToml);

  return tempDir;
}

describe("sync-version", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createFixture();
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("sync-version propagates main package version to Cargo.toml, platform packages, and optionalDependencies", () => {
    // Run the script with ASSUME_PKG_DIR pointing to our temp fixture
    execSync(`bun ${scriptPath}`, {
      env: { ...process.env, ASSUME_PKG_DIR: tempDir },
      stdio: "pipe",
    });

    // Verify main package.json has updated optionalDependencies
    const mainPkg = JSON.parse(readFileSync(resolve(tempDir, "package.json"), "utf8"));
    expect(mainPkg.version).toBe("9.9.9-test");
    expect(mainPkg.optionalDependencies["@glrs-dev/assume-darwin-arm64"]).toBe("9.9.9-test");
    expect(mainPkg.optionalDependencies["@glrs-dev/assume-darwin-x64"]).toBe("9.9.9-test");
    expect(mainPkg.optionalDependencies["@glrs-dev/assume-linux-x64"]).toBe("9.9.9-test");
    expect(mainPkg.optionalDependencies["@glrs-dev/assume-linux-arm64"]).toBe("9.9.9-test");
    expect(mainPkg.optionalDependencies["@glrs-dev/assume-win32-x64"]).toBe("9.9.9-test");

    // Verify platform packages are updated
    const platforms = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"];
    for (const plat of platforms) {
      const platPkg = JSON.parse(readFileSync(resolve(tempDir, "npm", plat, "package.json"), "utf8"));
      expect(platPkg.version).toBe("9.9.9-test");
    }

    // Verify Cargo.toml is updated
    const cargoRaw = readFileSync(resolve(tempDir, "Cargo.toml"), "utf8");
    expect(cargoRaw).toContain('version = "9.9.9-test"');
  });

  test("sync-version exits non-zero when main package version is 0.0.0", () => {
    // Set main package to 0.0.0
    const mainPkg = JSON.parse(readFileSync(resolve(tempDir, "package.json"), "utf8"));
    mainPkg.version = "0.0.0";
    writeFileSync(resolve(tempDir, "package.json"), JSON.stringify(mainPkg, null, 2) + "\n");

    let exitCode = 0;
    try {
      execSync(`bun ${scriptPath}`, {
        env: { ...process.env, ASSUME_PKG_DIR: tempDir },
        stdio: "pipe",
      });
    } catch (error) {
      exitCode = error.status;
    }

    expect(exitCode).toBe(1);
  });
});
