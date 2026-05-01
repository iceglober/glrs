/**
 * Config-surface assertions for docs-site/astro.config.mjs.
 *
 * Reads the config as text (no Astro runtime needed) and asserts:
 *   - No editLink property
 *   - sidebar uses autogenerate shape
 *   - Exactly four top-level groups
 *
 * Covers acceptance criterion a5.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../astro.config.mjs");

function readConfig(): string {
  return readFileSync(configPath, "utf8");
}

describe("astro.config.mjs surface", () => {
  test("astro.config.mjs does not export editLink", () => {
    const content = readConfig();
    expect(content).not.toContain("editLink");
  });

  test("astro.config.mjs sidebar uses autogenerate shape, not hardcoded items", () => {
    const content = readConfig();
    // Must have autogenerate entries
    expect(content).toContain("autogenerate:");
    // Should not have hardcoded slug entries for package sections
    // (the Start here group has a hardcoded item, but package sections use autogenerate)
    expect(content).toContain('autogenerate: { directory: "assume" }');
    expect(content).toContain('autogenerate: { directory: "cli" }');
    expect(content).toContain('autogenerate: { directory: "harness-opencode" }');
  });

  test("astro.config.mjs sidebar has exactly four top-level groups", () => {
    const content = readConfig();
    // Count top-level sidebar group labels
    const labelMatches = content.match(/\{\s*label:\s*["'][^"']+["'],\s*(?:items:|autogenerate:)/g);
    expect(labelMatches).not.toBeNull();
    expect(labelMatches!.length).toBe(4);
    // Verify the four expected labels are present
    expect(content).toContain('"Start here"');
    expect(content).toContain('"assume"');
    expect(content).toContain('"cli"');
    expect(content).toContain('"harness-opencode"');
  });
});
