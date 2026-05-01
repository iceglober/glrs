/**
 * Post-build smoke test for docs-site/dist/.
 *
 * Asserts expected routes exist in the built site and that ignored paths
 * are absent. Skips (not fails) when dist/ is absent — the verify command
 * chains `build` first.
 *
 * Covers acceptance criteria a7 and a11.
 */
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist");

function distExists(): boolean {
  return existsSync(distDir);
}

describe("built site contains expected pages", () => {
  test("built site contains /cli/, /harness-opencode/, /assume/, /install/, and /", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    expect(existsSync(resolve(distDir, "index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "cli/index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "harness-opencode/index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "assume/index.html"))).toBe(true);
    expect(existsSync(resolve(distDir, "install/index.html"))).toBe(true);
  });

  test("built site contains /harness-opencode/plugin-architecture/ and /harness-opencode/migration-from-clone-install/", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    expect(
      existsSync(resolve(distDir, "harness-opencode/plugin-architecture/index.html")),
    ).toBe(true);
    expect(
      existsSync(resolve(distDir, "harness-opencode/migration-from-clone-install/index.html")),
    ).toBe(true);
  });

  test("built site does not contain spike pages under /harness-opencode/pilot/spikes/", () => {
    if (!distExists()) {
      console.log("SKIP: dist/ not found — run build first");
      return;
    }
    expect(
      existsSync(resolve(distDir, "harness-opencode/pilot/spikes")),
    ).toBe(false);
  });
});
