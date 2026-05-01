/**
 * Stage-wiring assertions (acceptance criterion a3).
 *
 * Asserts:
 *   - package.json stage script uses bun run
 *   - package.json dev and build scripts invoke stage before astro
 *   - docs-site/.gitignore ignores staged content but preserves index.md
 *   - stager AUTHORED_FILES constant matches the .gitignore negation list
 *   - running the stager produces the expected set of staged files
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORED_FILES } from "../scripts/stage-docs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsiteDir = resolve(__dirname, "..");

describe("stage wiring", () => {
  test("package.json stage script uses bun run", () => {
    const pkg = JSON.parse(readFileSync(resolve(docsiteDir, "package.json"), "utf8"));
    expect(pkg.scripts?.stage).toBeDefined();
    expect(pkg.scripts.stage).toContain("bun run");
    expect(pkg.scripts.stage).toContain("stage-docs.mjs");
  });

  test("package.json dev and build scripts invoke stage before astro", () => {
    const pkg = JSON.parse(readFileSync(resolve(docsiteDir, "package.json"), "utf8"));
    expect(pkg.scripts?.dev).toMatch(/bun run stage.*&&.*astro/);
    expect(pkg.scripts?.build).toMatch(/bun run stage.*&&.*astro/);
  });

  test("docs-site/.gitignore ignores staged content but preserves docs-site/src/content/docs/index.md", () => {
    const gitignorePath = resolve(docsiteDir, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toContain("src/content/docs/**/*");
    expect(content).toContain("!src/content/docs/index.md");
  });

  test("stager AUTHORED_FILES constant matches the .gitignore negation list", () => {
    const gitignorePath = resolve(docsiteDir, ".gitignore");
    const content = readFileSync(gitignorePath, "utf8");

    // Extract negation entries from .gitignore (lines starting with !)
    // that are under src/content/docs/
    const negations = content
      .split("\n")
      .filter((line) => line.startsWith("!src/content/docs/"))
      .map((line) => line.replace("!src/content/docs/", "").trim());

    // AUTHORED_FILES should match the negation list
    for (const authored of AUTHORED_FILES) {
      expect(negations).toContain(authored);
    }
    for (const negated of negations) {
      expect(AUTHORED_FILES).toContain(negated);
    }
  });

  test("running the stager produces the expected set of staged files", async () => {
    // Run the stager and check that expected files are present
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      "bun",
      ["run", "scripts/stage-docs.mjs"],
      { cwd: docsiteDir, encoding: "utf8" }
    );

    if (result.status !== 0) {
      throw new Error(`Stager failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }

    const stagedContentDir = resolve(docsiteDir, "src/content/docs");

    // Expected staged files
    const expectedFiles = [
      "cli/index.md",
      "harness-opencode/index.md",
      "harness-opencode/plugin-architecture.md",
      "harness-opencode/migration-from-clone-install.md",
      "assume/index.md",
      "install.md",
    ];

    for (const file of expectedFiles) {
      const fullPath = resolve(stagedContentDir, file);
      expect(existsSync(fullPath), `Expected staged file to exist: ${file}`).toBe(true);
    }

    // Ignored files should NOT be staged
    const ignoredFiles = [
      "harness-opencode/pilot/spikes",
      "harness-opencode/archive",
      "harness-opencode/spike-results.md",
    ];
    for (const file of ignoredFiles) {
      const fullPath = resolve(stagedContentDir, file);
      expect(existsSync(fullPath), `Expected ignored file to NOT exist: ${file}`).toBe(false);
    }
  });
});
