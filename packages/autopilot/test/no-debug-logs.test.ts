/**
 * No-debug-logs test — a3 acceptance criterion.
 *
 * Fails if any source file in packages/adapter-opencode/src/ or
 * packages/autopilot/src/ contains /tmp/ file writes or glrs-cost-debug
 * references. Prevents debug logging from shipping.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

// Resolve paths relative to this test file's location
const repoRoot = resolve(import.meta.dir, "../../..");
const adapterSrc = join(repoRoot, "packages/adapter-opencode/src");
const autopilotSrc = join(repoRoot, "packages/autopilot/src");
const cliTuiSrc = join(repoRoot, "packages/cli/src/tui");

describe("no /tmp/ or debug file writes in adapter or loop source", () => {
  const sourceFiles = [
    ...collectSourceFiles(adapterSrc),
    ...collectSourceFiles(autopilotSrc),
    ...collectSourceFiles(cliTuiSrc),
  ];

  it("no source file writes to /tmp/ paths", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8");
      // Match appendFileSync or writeFileSync calls with /tmp/ paths
      if (/appendFileSync\s*\(\s*["'`]\/tmp\//.test(content) ||
          /writeFileSync\s*\(\s*["'`]\/tmp\//.test(content)) {
        violations.push(file.replace(repoRoot + "/", ""));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Found /tmp/ file writes in production source:\n${violations.map(f => `  - ${f}`).join("\n")}\n\nRemove all debug logging before shipping.`
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("no source file references glrs-cost-debug log", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8");
      if (content.includes("glrs-cost-debug")) {
        violations.push(file.replace(repoRoot + "/", ""));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Found glrs-cost-debug references in production source:\n${violations.map(f => `  - ${f}`).join("\n")}\n\nRemove all debug logging before shipping.`
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("no source file uses require(node:fs) for debug logging", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf-8");
      // Detect the specific debug pattern: require("node:fs") inside a try block
      // (the pattern used in AutopilotExecution.tsx for debug logging)
      if (/require\s*\(\s*["']node:fs["']\s*\)/.test(content)) {
        violations.push(file.replace(repoRoot + "/", ""));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Found require("node:fs") in production source (debug logging pattern):\n${violations.map(f => `  - ${f}`).join("\n")}\n\nRemove all debug logging before shipping.`
      );
    }
    expect(violations).toHaveLength(0);
  });
});
