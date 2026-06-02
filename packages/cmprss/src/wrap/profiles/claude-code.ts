/**
 * claude-code wrap profile.
 *
 * Routes Claude Code's Anthropic Messages traffic through the cmprss proxy
 * by injecting ANTHROPIC_BASE_URL + a stub bearer. Strips CLAUDE_CODE_USE_BEDROCK
 * from the child env if set (otherwise Claude Code would talk to Bedrock
 * directly, bypassing us).
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface ClaudeCodeWrapContext {
  proxyUrl: string;
  stubBearer: string;
  /** Bedrock model ID that the proxy will route to (display only). */
  resolvedModel: string;
  /** Short alias the user picked, e.g. "sonnet" — sent as `ANTHROPIC_MODEL`. */
  modelAlias: string;
}

export interface DetectResult {
  installed: boolean;
  version?: string;
  path?: string;
}

export const CLAUDE_CODE_BINS = ["claude"];

export async function detectClaudeCode(): Promise<DetectResult> {
  for (const bin of CLAUDE_CODE_BINS) {
    const which = Bun.spawnSync(["which", bin]);
    if (which.exitCode === 0) {
      const path = (which.stdout.toString() ?? "").trim();
      let version: string | undefined;
      try {
        const v = Bun.spawnSync([bin, "--version"]);
        if (v.exitCode === 0) version = v.stdout.toString().trim();
      } catch {
        // version probe is best-effort
      }
      return { installed: true, path, ...(version ? { version } : {}) };
    }
  }
  return { installed: false };
}

export function claudeCodeEnv(
  ctx: ClaudeCodeWrapContext,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  env.ANTHROPIC_BASE_URL = ctx.proxyUrl;
  env.ANTHROPIC_API_KEY = ctx.stubBearer;
  env.ANTHROPIC_MODEL = ctx.resolvedModel;
  // CRITICAL: drop the Bedrock-native env or Claude Code will bypass the proxy.
  delete env.CLAUDE_CODE_USE_BEDROCK;
  return env;
}

export function spawnClaudeCode(
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn("claude", args, {
    stdio: "inherit",
    env,
  });
}
