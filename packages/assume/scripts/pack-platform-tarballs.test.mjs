#!/usr/bin/env node
/**
 * scripts/pack-platform-tarballs.test.mjs
 *
 * Unit tests for pack-platform-tarballs.mjs. Creates temporary fixtures
 * and verifies binaries are staged correctly.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const scriptPath = resolve(import.meta.dirname, "pack-platform-tarballs.mjs");

function createFixture() {
  const tempDir = mkdtempSync(resolve(tmpdir(), "pack-platforms-test-"));

  // Create artifact directories with fake binaries
  const platforms = [
    { key: "darwin-arm64", exe: false },
    { key: "darwin-x64", exe: false },
    { key: "linux-x64", exe: false },
    { key: "linux-arm64", exe: false },
    { key: "win32-x64", exe: true },
  ];

  for (const { key, exe } of platforms) {
    const artifactDir = resolve(tempDir, ".release-artifacts", key);
    mkdirSync(artifactDir, { recursive: true });

    const suffix = exe ? ".exe" : "";
    // Create fake binaries (just empty files for testing)
    writeFileSync(resolve(artifactDir, `gs-assume${suffix}`), "fake-binary");
    writeFileSync(resolve(artifactDir, `gsa${suffix}`), "fake-binary");

    // Create npm platform directory
    const npmDir = resolve(tempDir, "npm", key);
    mkdirSync(npmDir, { recursive: true });
    writeFileSync(resolve(npmDir, "package.json"), JSON.stringify({ name: `@glrs-dev/assume-${key}` }));
  }

  return tempDir;
}

describe("pack-platforms", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createFixture();
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("pack-platforms copies gs-assume and gsa binaries into each platform bin dir", () => {
    execSync(`bun ${scriptPath}`, {
      env: { ...process.env, ASSUME_PKG_DIR: tempDir },
      stdio: "pipe",
    });

    // Verify binaries exist in each platform's bin/ directory
    const platforms = [
      { key: "darwin-arm64", exe: false },
      { key: "darwin-x64", exe: false },
      { key: "linux-x64", exe: false },
      { key: "linux-arm64", exe: false },
      { key: "win32-x64", exe: true },
    ];

    for (const { key, exe } of platforms) {
      const binDir = resolve(tempDir, "npm", key, "bin");
      const suffix = exe ? ".exe" : "";

      expect(existsSync(resolve(binDir, `gs-assume${suffix}`))).toBe(true);
      expect(existsSync(resolve(binDir, `gsa${suffix}`))).toBe(true);
    }
  });

  test("pack-platforms exits non-zero when any platform artifact is missing", () => {
    // Remove one artifact directory
    rmSync(resolve(tempDir, ".release-artifacts", "linux-x64"), { recursive: true, force: true });

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

  test("pack-platforms sets mode 0755 on unix binaries and preserves .exe suffix on windows", () => {
    execSync(`bun ${scriptPath}`, {
      env: { ...process.env, ASSUME_PKG_DIR: tempDir },
      stdio: "pipe",
    });

    // Unix platforms should have mode 0755
    const unixPlatforms = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
    for (const key of unixPlatforms) {
      const gsAssumeStat = statSync(resolve(tempDir, "npm", key, "bin", "gs-assume"));
      const gsaStat = statSync(resolve(tempDir, "npm", key, "bin", "gsa"));

      // Check executable bit is set (mode & 0o111)
      expect(gsAssumeStat.mode & 0o111).toBeTruthy();
      expect(gsaStat.mode & 0o111).toBeTruthy();
    }

    // Windows platform should have .exe suffix
    expect(existsSync(resolve(tempDir, "npm", "win32-x64", "bin", "gs-assume.exe"))).toBe(true);
    expect(existsSync(resolve(tempDir, "npm", "win32-x64", "bin", "gsa.exe"))).toBe(true);
  });
});
