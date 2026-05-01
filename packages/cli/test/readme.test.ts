/**
 * Regression guard: packages/cli/README.md accurately documents the CLI surface.
 *
 * Asserts:
 *   - All five named glrs wt subcommands are mentioned
 *   - The bare glrs wt interactive fallback is documented
 *   - "glrs wt go" does NOT appear (go is not a named subcommand)
 *
 * Covers acceptance criterion a6.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readmePath = resolve(__dirname, "../README.md");
const readme = readFileSync(readmePath, "utf8");

describe("packages/cli/README.md", () => {
  test("README lists all five named glrs wt subcommands", () => {
    expect(readme).toContain("glrs wt new");
    expect(readme).toContain("glrs wt list");
    expect(readme).toContain("glrs wt switch");
    expect(readme).toContain("glrs wt delete");
    expect(readme).toContain("glrs wt cleanup");
  });

  test("README documents the bare glrs wt interactive fallback", () => {
    // Should mention interactive behavior for bare invocation
    // Loose regex: accepts "interactive" near "bare" or "no args" or "glrs wt" alone
    expect(readme).toMatch(/interactive/i);
    // Should also mention the bare invocation pattern
    expect(readme).toMatch(/bare|no args|no subcommand|without.*arg|glrs wt`\s*—/i);
  });

  test("README does NOT describe go as a named subcommand", () => {
    // "glrs wt go" must not appear — go is the internal function name, not a CLI subcommand
    expect(readme).not.toContain("glrs wt go");
  });
});
