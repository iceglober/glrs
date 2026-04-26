import type { BunPlugin } from "bun";
import pkg from "./package.json";

// Embed sql.js WASM binary as base64 so the CLI is fully self-contained
// and doesn't depend on node_modules paths at runtime.
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
const wasmBase64 = Buffer.from(await Bun.file(wasmPath).arrayBuffer()).toString("base64");

// Shim out react-devtools-core (ink imports it but it's not needed in CLI)
const shimDevtools: BunPlugin = {
  name: "shim-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "shim",
    }));
    build.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  splitting: false,
  minify: false,
  define: {
    __GLORIOUS_VERSION__: JSON.stringify(pkg.version),
    __SQL_WASM_BASE64__: JSON.stringify(wasmBase64),
  },
  packages: "bundle",
  plugins: [shimDevtools],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Prepend shebang to the output
const outPath = "dist/index.js";
const content = await Bun.file(outPath).text();
await Bun.write(outPath, `#!/usr/bin/env node\n${content}`);

const size = Bun.file(outPath).size;
console.log(`dist/index.js ${(size / 1024 / 1024).toFixed(2)} MB`);
