/**
 * Architecture assertions for the docs-site refactor (acceptance criterion a1).
 *
 * Asserts:
 *   - content.config.ts uses glob() from astro/loaders and does NOT reference glrsContentLoader
 *   - docs-site/src/loader.ts does not exist
 *   - docs-site/test/loader.test.ts does not exist
 *   - docs-site/test/fixtures/ does not exist
 *   - gray-matter remains a dependency (moved from loader to stager)
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsiteDir = resolve(__dirname, "..");

describe("architecture: custom loader removed, native glob() in place", () => {
  test("content.config.ts imports glob from astro/loaders and does not reference glrsContentLoader", () => {
    const configPath = resolve(docsiteDir, "src/content.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain('from "astro/loaders"');
    expect(content).toContain("glob(");
    expect(content).not.toContain("glrsContentLoader");
    expect(content).not.toContain("./loader");
  });

  test("docs-site/src/loader.ts does not exist", () => {
    const loaderPath = resolve(docsiteDir, "src/loader.ts");
    expect(existsSync(loaderPath)).toBe(false);
  });

  test("docs-site/test/loader.test.ts does not exist", () => {
    const loaderTestPath = resolve(docsiteDir, "test/loader.test.ts");
    expect(existsSync(loaderTestPath)).toBe(false);
  });

  test("docs-site/test/fixtures/ does not exist", () => {
    const fixturesDir = resolve(docsiteDir, "test/fixtures");
    expect(existsSync(fixturesDir)).toBe(false);
  });

  test("gray-matter remains a dependency in docs-site/package.json", () => {
    const pkgPath = resolve(docsiteDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    expect(pkg.dependencies?.["gray-matter"]).toBeDefined();
  });
});
