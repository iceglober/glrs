/**
 * opencode wrap profile.
 *
 * Sets ANTHROPIC_BASE_URL + a stub key so opencode's anthropic provider
 * sends Messages-shaped traffic to cmprss. Does NOT touch model selection —
 * opencode chooses what to use per request; the proxy maps each request to
 * the right Bedrock inference profile.
 *
 * Caveat: opencode's `amazon-bedrock/*`, `openai/*`, `google-vertex/*` etc.
 * providers do not honor `ANTHROPIC_BASE_URL` and will bypass cmprss. Only
 * traffic that opencode routes through its `anthropic/*` provider reaches us.
 * To force-route, pick an `anthropic/*` model in the opencode TUI (or set one
 * as the default in `~/.config/opencode/opencode.json`).
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface OpencodeWrapContext {
  proxyUrl: string;
  stubBearer: string;
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

export function opencodeEnv(
  ctx: OpencodeWrapContext,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  env.ANTHROPIC_BASE_URL = ctx.proxyUrl;
  env.ANTHROPIC_API_KEY = ctx.stubBearer;
  if (!env.OPENCODE_DISABLE_AUTOUPDATE) env.OPENCODE_DISABLE_AUTOUPDATE = "1";
  return env;
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
