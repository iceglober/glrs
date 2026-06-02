/**
 * opencode wrap profile.
 *
 * Routes opencode's Anthropic-provider traffic through the cmprss proxy. Note
 * that opencode's `amazon-bedrock/*` provider talks to Bedrock directly via
 * AWS SDK — `ANTHROPIC_BASE_URL` has no effect on those models. For traffic to
 * flow through cmprss, opencode must use the `anthropic` provider; we inject
 * `--model anthropic/<id>` unless the user explicitly passed `--model`.
 *
 * In-session model switches to `amazon-bedrock/*` will bypass cmprss until the
 * user picks an `anthropic/*` model again.
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface OpencodeWrapContext {
  proxyUrl: string;
  stubBearer: string;
  /** Bedrock model ID the proxy routes to (display only — not sent to opencode). */
  resolvedModel: string;
  /** Short alias the user picked (sonnet/haiku/opus or custom). */
  modelAlias: string;
}

export interface DetectResult {
  installed: boolean;
  version?: string;
  path?: string;
}

export const OPENCODE_BINS = ["opencode"];

export async function detectOpencode(): Promise<DetectResult> {
  for (const bin of OPENCODE_BINS) {
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

/**
 * Map a cmprss short name (sonnet/haiku/opus) to the opencode anthropic-provider
 * model ID. The proxy then re-routes that to whatever Bedrock inference profile
 * resolveModel() returned at wrap time, so the alignment of the dates here vs.
 * the Bedrock catalog doesn't matter functionally — only that opencode accepts
 * the model ID and uses its anthropic provider.
 */
const OPENCODE_MODEL_DEFAULTS: Record<string, string> = {
  sonnet: "anthropic/claude-sonnet-4-5-20250929",
  haiku: "anthropic/claude-haiku-4-5-20251001",
  opus: "anthropic/claude-opus-4-7",
};

export function opencodeModelArg(alias: string): string {
  // If the user passed a full opencode model ID (contains '/'), use as-is.
  if (alias.includes("/")) return alias;
  return OPENCODE_MODEL_DEFAULTS[alias] ?? OPENCODE_MODEL_DEFAULTS.sonnet;
}

export function opencodeEnv(
  ctx: OpencodeWrapContext,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  env.ANTHROPIC_BASE_URL = ctx.proxyUrl;
  env.ANTHROPIC_API_KEY = ctx.stubBearer;
  // Help opencode skip its first-run prompt for the anthropic provider.
  // OPENCODE_DISABLE_AUTOUPDATE keeps the wrap session quiet during dogfood.
  if (!env.OPENCODE_DISABLE_AUTOUPDATE) env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  return env;
}

/**
 * Inject `--model anthropic/<id>` into the spawn args unless the user already
 * passed `--model`. opencode honors --model as a default-model override for
 * the session.
 */
export function withDefaultModelArg(
  userArgs: string[],
  modelAlias: string,
): string[] {
  if (userArgs.some((a) => a === "--model" || a.startsWith("--model="))) {
    return userArgs;
  }
  return [...userArgs, "--model", opencodeModelArg(modelAlias)];
}

export function spawnOpencode(
  args: string[],
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn("opencode", args, {
    stdio: "inherit",
    env,
  });
}
