/**
 * Tests for credential-refresh helpers.
 *
 * DI-based — `attemptCredentialRefresh` invokes execFile by default,
 * but tests inject a mock so no real `aws sso login` / `az login`
 * commands are ever run.
 */

import { describe, it, expect } from "bun:test";
import {
  detectProvider,
  attemptCredentialRefresh,
  type CredentialRefreshDeps,
} from "../src/lib/credential-refresh.js";

describe("detectProvider", () => {
  it("identifies AWS Bedrock model IDs", () => {
    expect(detectProvider("bedrock/anthropic.claude-3-haiku")).toBe("aws");
    expect(detectProvider("amazon-bedrock/global.anthropic.claude-opus-4-7")).toBe("aws");
    expect(detectProvider("aws/claude-sonnet-4-5")).toBe("aws");
  });

  it("identifies Azure model IDs", () => {
    expect(detectProvider("azure/gpt-4")).toBe("azure");
    expect(detectProvider("https://mycompany.openai.azure.com/deployments/x")).toBe("azure");
  });

  it("returns 'unknown' for non-matching providers", () => {
    expect(detectProvider("openai/gpt-4")).toBe("unknown");
    expect(detectProvider("anthropic/claude-3-opus")).toBe("unknown");
    expect(detectProvider("")).toBe("unknown");
    expect(detectProvider(undefined as unknown as string)).toBe("unknown");
  });

  it("matches case-insensitively", () => {
    expect(detectProvider("BEDROCK/claude")).toBe("aws");
    expect(detectProvider("AZURE/gpt-4")).toBe("azure");
  });
});

describe("attemptCredentialRefresh", () => {
  it("invokes `aws sso login` for the aws provider", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const deps: CredentialRefreshDeps = {
      exec: async (cmd, args) => {
        calls.push({ cmd, args });
        return { stdout: "", stderr: "" };
      },
    };
    const ok = await attemptCredentialRefresh("aws", deps);
    expect(ok).toBe(true);
    expect(calls).toEqual([{ cmd: "aws", args: ["sso", "login"] }]);
  });

  it("invokes `az login` for the azure provider", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const deps: CredentialRefreshDeps = {
      exec: async (cmd, args) => {
        calls.push({ cmd, args });
        return { stdout: "", stderr: "" };
      },
    };
    const ok = await attemptCredentialRefresh("azure", deps);
    expect(ok).toBe(true);
    expect(calls).toEqual([{ cmd: "az", args: ["login"] }]);
  });

  it("returns false for unknown provider without invoking anything", async () => {
    const calls: Array<unknown> = [];
    const ok = await attemptCredentialRefresh("unknown", {
      exec: async (...args) => {
        calls.push(args);
        return { stdout: "", stderr: "" };
      },
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns false on exec failure (e.g., command not found)", async () => {
    const ok = await attemptCredentialRefresh("aws", {
      exec: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(ok).toBe(false);
  });
});
