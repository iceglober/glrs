/**
 * Source-level assertions for the homepage (acceptance criterion a4).
 *
 * Reads docs-site/src/content/docs/index.md and asserts:
 *   - No import statements (no MDX)
 *   - No <Card or <CardGrid components
 *   - Has three ### @glrs-dev/ H3 headings
 *   - Has links to /cli/, /harness-opencode/, and /assume/
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsiteDir = resolve(__dirname, "..");
const homepagePath = resolve(docsiteDir, "src/content/docs/index.md");

describe("homepage source shape", () => {
  test("homepage source is plain markdown (no import statements, no <Card> or <CardGrid>)", () => {
    const content = readFileSync(homepagePath, "utf8");
    expect(content).not.toMatch(/^import\s+/m);
    expect(content).not.toContain("<Card");
    expect(content).not.toContain("<CardGrid");
  });

  test("homepage has three ### @glrs-dev/ H3 headings", () => {
    const content = readFileSync(homepagePath, "utf8");
    const h3Matches = content.match(/^### @glrs-dev\//gm);
    expect(h3Matches).not.toBeNull();
    expect(h3Matches!.length).toBe(3);
  });

  test("homepage has links to /cli/, /harness-opencode/, and /assume/", () => {
    const content = readFileSync(homepagePath, "utf8");
    expect(content).toContain("/cli/");
    expect(content).toContain("/harness-opencode/");
    expect(content).toContain("/assume/");
  });

  test("homepage has splash template and hero block", () => {
    const content = readFileSync(homepagePath, "utf8");
    expect(content).toContain("template: splash");
    expect(content).toContain("hero:");
    expect(content).toContain("tagline:");
  });
});
