/**
 * Regression tests for src/lib/opencode-server.ts.
 *
 * Guards against the `baseUrl` → `url` typo bug that shipped silently:
 * `Config` extends `RequestInit`, which accepts arbitrary extra keys via
 * structural typing. A wrong key name silently built requests with NO
 * base URL, producing "Invalid URL" errors on the first API call.
 *
 * Strategy: mock @opencode-ai/sdk only (NOT node:child_process — that
 * leaks across files in Bun's shared module cache). The real
 * `ensureOpencodeOnPath` runs; skip the test if opencode isn't on PATH.
 */

import { describe, it, expect, mock } from "bun:test";
import { execFileSync } from "node:child_process";

function opencodeAvailable(): boolean {
  try {
    execFileSync("opencode", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe("opencode-server: startServer passes baseUrl to SDK client", () => {
  it.skipIf(!opencodeAvailable())(
    "createOpencodeClient receives `baseUrl`, not `url`",
    async () => {
      let capturedConfig: Record<string, unknown> | null = null;

      mock.module("@opencode-ai/sdk", () => ({
        createOpencodeServer: async () => ({
          url: "http://127.0.0.1:12345",
          close: async () => {},
        }),
        createOpencodeClient: (config: Record<string, unknown>) => {
          capturedConfig = config;
          return { session: { list: async () => [] } };
        },
      }));

      const { startServer } = await import("../src/lib/opencode-server.js");

      const server = await startServer({ cwd: "/tmp" });

      expect(capturedConfig).not.toBeNull();
      expect(capturedConfig).toHaveProperty("baseUrl");
      expect((capturedConfig as { baseUrl: string }).baseUrl).toBe(
        "http://127.0.0.1:12345",
      );
      // Guards against regression to the buggy key name:
      expect(capturedConfig).not.toHaveProperty("url");

      await server.shutdown();
    },
  );
});
