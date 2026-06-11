/**
 * vendored-externals.test.ts — every bare-specifier import reachable at
 * runtime from the published CLI must resolve against the CLI's own
 * `dependencies`.
 *
 * Why: workspace packages (harness-plugin-opencode, autopilot, adapters) are
 * vendored under dist/node_modules with their package.json stripped of
 * dependencies — their externals resolve against the CLI's top-level deps at
 * install time. When a vendored package gains a new external dependency and
 * nobody adds it to packages/cli/package.json, the workspace build keeps
 * working (hoisted node_modules) and the break only surfaces for npm users:
 * `Cannot find module '@clack/prompts' from '.../dist/.../cli-exports.js'`
 * (the 3.17.0 `glrs harness configure` regression this test was written
 * after).
 *
 * The check: scan every .js file in dist/ (CLI bundles + vendored dists) for
 * static and dynamic string-literal imports, map each specifier to its
 * package name, and assert it is a node:/bun: builtin, a vendored @glrs-dev
 * package, or declared in the CLI's dependencies/optionalDependencies.
 *
 * Requires the build to have run. beforeAll invokes the build and bails if
 * it fails (same pattern as vendor-layout.test.ts).
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { builtinModules } from "node:module";
import { $ } from "bun";

const CLI_ROOT = resolve(import.meta.dir, "..");
const DIST = join(CLI_ROOT, "dist");

beforeAll(async () => {
  const result = await $`bun run build`.cwd(CLI_ROOT).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`,
    );
  }
}, 120_000);

function walkJsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkJsFiles(full, out);
    } else if (entry.endsWith(".js") || entry.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

/** "yaml/util" → "yaml"; "@inquirer/prompts/foo" → "@inquirer/prompts". */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

// A plausible npm specifier — filters out prose that happens to contain
// `from "..."` (agent prompts embed sentences like that).
const SPECIFIER_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(\/[\w\-./]*)?$/i;

function bareImports(source: string): Set<string> {
  const specs = new Set<string>();
  // `... from "x"` terminates both static import and re-export statements.
  const fromRe = /\bfrom\s*["']([^"'\n]+)["']/g;
  // Side-effect imports: `import "x"` at statement start.
  const sideEffectRe = /^import\s*["']([^"'\n]+)["']/gm;
  // Dynamic: import("x") — string literals only.
  const dynamicRe = /import\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
  // CJS interop in bundles: require("x").
  const requireRe = /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
  for (const re of [fromRe, sideEffectRe, dynamicRe, requireRe]) {
    for (const m of source.matchAll(re)) {
      const spec = m[1]!;
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) continue;
      if (!SPECIFIER_RE.test(spec) && !spec.includes(":")) continue;
      specs.add(spec);
    }
  }
  return specs;
}

describe("vendored externals resolve against CLI dependencies", () => {
  it("every bare import in dist/ is a builtin, vendored, or declared dep", () => {
    const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
    const declared = new Set<string>([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);
    const builtins = new Set([
      ...builtinModules,
      ...builtinModules.map((m) => `node:${m}`),
    ]);

    const failures: string[] = [];
    for (const file of walkJsFiles(DIST)) {
      for (const spec of bareImports(readFileSync(file, "utf8"))) {
        if (spec.startsWith("node:") || spec.startsWith("bun:")) continue;
        if (builtins.has(spec)) continue;
        const name = packageName(spec);
        // Vendored workspace packages resolve from dist/node_modules.
        if (name.startsWith("@glrs-dev/")) continue;
        if (declared.has(name)) continue;
        failures.push(`${name} (as "${spec}") imported by ${file.slice(DIST.length + 1)}`);
      }
    }

    expect(
      failures,
      `Bare imports not declared in packages/cli dependencies — npm installs ` +
        `of the CLI will crash with "Cannot find module". Add them to ` +
        `packages/cli/package.json dependencies:\n  ${[...new Set(failures)].join("\n  ")}`,
    ).toEqual([]);
  });
});
