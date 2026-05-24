import { defineConfig } from "tsup";
import { cpSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["pino", "pino-pretty", "yaml", "zod"],
  async onSuccess() {
    // Copy markdown assets that tsup doesn't bundle automatically.
    // dist/strategies/ mirrors src/strategies/ (enrichment strategy templates).
    cpSync(join("src", "strategies"), join("dist", "strategies"), { recursive: true });
    // dist/prompt-template.md mirrors src/prompt-template.md (loop prompt template).
    cpSync(join("src", "prompt-template.md"), join("dist", "prompt-template.md"));
  },
});
