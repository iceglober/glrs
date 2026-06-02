import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/cmprss": "bin/cmprss.ts",
  },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  // AWS SDK is heavy and well-shaped for external import; pino is native.
  external: [
    "@aws-sdk/client-bedrock-runtime",
    "@aws-sdk/credential-providers",
    "pino",
    "bun:sqlite",
    "bun:test",
  ],
  banner: ({ format }) => {
    // Only the bin entry needs a shebang. tsup applies the banner per-file,
    // so we add it globally and trust that imports into library use don't break
    // (ESM ignores a shebang on the first line when the file is imported via
    // dynamic import; but to be safe we keep the bin entry separate and add
    // the shebang in the entry itself).
    return format === "esm" ? {} : {};
  },
});
