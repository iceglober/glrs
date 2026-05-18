/**
 * Best-effort credential refresh helpers.
 *
 * The autopilot detects expired credentials via `classifyError` (see
 * src/lib/error-classifier.ts) and surfaces an actionable message
 * pointing the user at `gs-assume`. This module provides the
 * scaffolding for an *opt-in* refresh path that invokes the user's
 * SSO command directly (`aws sso login`, `az login`).
 *
 * NOTE: The default policy is to NOT invoke these commands
 * automatically — they typically open a browser for OAuth, and
 * lights-out autopilot has no human to complete the login flow.
 * Callers who genuinely want to attempt a refresh (e.g., a future
 * desktop UI flow) can call `attemptCredentialRefresh` explicitly.
 *
 * Provider detection is a simple prefix/substring check on the model
 * ID resolved from opencode.json:
 *   - bedrock/, amazon-bedrock/, aws/   → AWS
 *   - azure/, *.azure.*                  → Azure
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export type CredentialProvider = "aws" | "azure" | "unknown";

/**
 * Detect the credential provider from a fully-qualified model ID.
 * Examples:
 *   "bedrock/anthropic.claude-3-haiku" → "aws"
 *   "amazon-bedrock/global.anthropic.claude-opus-4-7" → "aws"
 *   "aws/claude-sonnet-4-5" → "aws"
 *   "azure/gpt-4" → "azure"
 *   "openai/gpt-4" → "unknown"
 */
export function detectProvider(modelName: string): CredentialProvider {
  if (typeof modelName !== "string" || modelName.length === 0) {
    return "unknown";
  }
  const lower = modelName.toLowerCase();
  if (
    lower.startsWith("bedrock/") ||
    lower.startsWith("amazon-bedrock/") ||
    lower.startsWith("aws/")
  ) {
    return "aws";
  }
  if (lower.startsWith("azure/") || lower.includes(".azure.")) {
    return "azure";
  }
  return "unknown";
}

/**
 * Injectable execFile for testing.
 * @internal
 */
export interface CredentialRefreshDeps {
  exec?: (
    cmd: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Attempt to refresh credentials for the given provider by invoking
 * the user's SSO CLI (`aws sso login` or `az login`). Best-effort:
 * returns true on success, false on any failure (including "command
 * not found", "user declined", or "browser auth timed out").
 *
 * Default policy — see module-level note: callers should NOT invoke
 * this automatically in headless autopilot runs. The recommended path
 * is to write a checkpoint and exit with an actionable message
 * (`Run gs-assume and then glrs oc autopilot --resume`).
 */
export async function attemptCredentialRefresh(
  provider: CredentialProvider,
  deps?: CredentialRefreshDeps,
): Promise<boolean> {
  if (provider === "unknown") return false;

  const exec =
    deps?.exec ??
    ((cmd: string, args: string[]) =>
      execFile(cmd, args, {
        // SSO commands frequently take 30+ seconds (browser flow).
        timeout: 5 * 60 * 1000,
      }));

  try {
    if (provider === "aws") {
      await exec("aws", ["sso", "login"]);
      return true;
    }
    if (provider === "azure") {
      await exec("az", ["login"]);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
