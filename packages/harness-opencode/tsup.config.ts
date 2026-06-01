import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import pkg from "./package.json" with { type: "json" };

// Recursively copy a directory tree. Optional `skip` filter receives the
// relative path (from the initial `src` root) and returns true to skip.
function copyDir(
  src: string,
  dst: string,
  skip?: (relPath: string) => boolean,
  rootSrc = src,
) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    const rel = relative(rootSrc, srcPath);
    if (skip?.(rel)) continue;
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, dstPath, skip, rootSrc);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli-exports": "src/cli-exports.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  // Bake the package version into the bundle so src/telemetry.ts can
  // reference it without a runtime require("./package.json").
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  // Treat markdown files as raw text strings (imported via ?raw)
  loader: {
    ".md": "text",
    ".sh": "text",
  },
  // Bundle everything except bun's builtin modules. `bun:sqlite`/`bun:test`
  // are bun-provided builtins (resolved at runtime); esbuild can't bundle them.
  //
  // NOTE: `@opencode-ai/plugin` is intentionally NOT external. Five custom-tool
  // modules do a runtime VALUE import (`import { tool }`), and the package is
  // ESM-only with its own `zod` dependency. Left external, opencode could not
  // resolve it from the plugin's cache dir (`Cannot find module
  // '@opencode-ai/plugin'`), so the entire harness failed to load. Bundling
  // inlines the stateless `tool` helper, so the published dist needs zero
  // runtime resolution of the opencode plugin SDK. `@opencode-ai/sdk` stays
  // external because every import of it is type-only (erased at build).
  external: [
    "@opencode-ai/sdk",
    "bun:sqlite",
    "bun:test",
  ],
  // Force-bundle these. tsup auto-externalizes everything in `dependencies`
  // and `peerDependencies`, so listing them here is required to override that.
  //   - @glrs-dev/agent-core: private source-only workspace pkg (not on npm).
  //   - @opencode-ai/plugin: peer dep, but five custom-tool modules import the
  //     runtime `tool` helper from it; opencode can't resolve it from the
  //     plugin's cache dir, so it must be inlined (see `external` note above).
  // `zod` is the only third-party runtime value-dep the plugin entry pulls in
  // (custom tools define schemas with it). Bundle it so `dist/index.js` has
  // ZERO third-party runtime deps — opencode loads the plugin even when its
  // cache dep-install fails (e.g. the historical `workspace:*` leak), which it
  // can't if the entry needs to resolve an uninstalled package.
  noExternal: ["@glrs-dev/agent-core", "@opencode-ai/plugin", "zod"],
  // After build: copy skills tree and bin scripts
  async onSuccess() {
    // Copy skills
    try {
      copyDir("src/skills", "dist/skills", (rel) => rel === "AGENTS.md");
      console.log("✓ Copied src/skills → dist/skills");
    } catch (e) {
      console.warn("! Could not copy skills:", e);
    }
    // Copy agent prompts (read at runtime via readFileSync)
    try {
      copyDir("src/agents/prompts", "dist/agents/prompts");
      copyDir("src/agents/shared", "dist/agents/shared");
      console.log("✓ Copied agent prompts → dist/agents/");
    } catch (e) {
      console.warn("! Could not copy agent prompts:", e);
    }
    // Copy command prompts
    try {
      copyDir("src/commands/prompts", "dist/commands/prompts");
      console.log("✓ Copied command prompts → dist/commands/");
    } catch (e) {
      console.warn("! Could not copy command prompts:", e);
    }
    // Copy enrichment strategies
    try {
      copyDir("src/autopilot/strategies", "dist/autopilot/strategies");
      console.log("✓ Copied src/autopilot/strategies → dist/autopilot/strategies");
    } catch (e) {
      console.warn("! Could not copy strategies:", e);
    }
    // Note: autopilot prompt template has moved to @glrs-dev/autopilot package
    // Copy bin scripts
    try {
      mkdirSync("dist/bin", { recursive: true });
      copyFileSync(
        "src/bin/memory-mcp-launcher.sh",
        "dist/bin/memory-mcp-launcher.sh",
      );
      console.log("✓ Copied bin scripts → dist/bin/");
    } catch (e) {
      console.warn("! Could not copy bin scripts:", e);
    }
  },
});
