/**
 * Pino logger with credential redaction.
 *
 * File-only by default — log path defaults to `<cwd>/.agent/cmprss-logs/<ts>.log`.
 * Stderr stays clean for the wrapped agent's TUI. Override with
 * `CMPRSS_LOG_FILE=/path/to/file.log`.
 */

import { mkdirSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pino from "pino";
import type { Logger } from "pino";

let cached: Logger | null = null;

function defaultLogPath(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return resolve(process.cwd(), ".agent", "cmprss-logs", `${ts}.log`);
}

export function getLogger(): Logger {
  if (cached) return cached;
  const target = process.env.CMPRSS_LOG_FILE ?? defaultLogPath();
  try {
    mkdirSync(dirname(target), { recursive: true });
  } catch {
    // If we can't create the log dir, fall through to in-memory pino.
  }
  let dest: pino.DestinationStream;
  try {
    dest = createWriteStream(target, { flags: "a" });
  } catch {
    // Final fallback: pino's default destination (stderr); shouldn't happen
    // outside very locked-down environments.
    dest = pino.destination({ dest: 2, sync: false });
  }
  cached = pino(
    {
      level: process.env.CMPRSS_LOG_LEVEL ?? "info",
      base: { pkg: "cmprss" },
      redact: {
        paths: [
          "*.authorization",
          "*.Authorization",
          "*['x-api-key']",
          "*['X-Api-Key']",
          'headers["authorization"]',
          'headers["x-api-key"]',
          'headers["x-amz-security-token"]',
          'req.headers["authorization"]',
          'req.headers["x-api-key"]',
          'req.headers["cookie"]',
        ],
        censor: "[redacted]",
      },
    },
    dest,
  );
  return cached;
}

export function logFilePath(): string {
  return process.env.CMPRSS_LOG_FILE ?? defaultLogPath();
}

/** Test seam — drop the cached logger so the next getLogger() rebuilds it. */
export function __resetLogger(): void {
  cached = null;
}

// Re-export to avoid `join` being flagged unused — used by callers that
// build their own log paths off the same convention.
export { join as joinPath };
