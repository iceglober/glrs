/**
 * Structured logger for the autopilot CLI.
 *
 * Pretty-printed to stderr by default (suits unattended-loop UX — the
 * user wants to see activity without it mixing into stdout). Switches
 * to raw JSON when GLRS_LOG_FORMAT=json or when stderr is not a TTY
 * (e.g., piped to a file), so downstream consumers can parse.
 *
 * Log levels:
 *   - fatal: unrecoverable errors that end the loop
 *   - error: recoverable errors (iteration failed, will retry)
 *   - warn:  progress concerns (struggle signal, stall warnings)
 *   - info:  iteration boundaries, sentinel/exit events (default level)
 *   - debug: tool-call heartbeat, SSE event traces (-v flag)
 *   - trace: raw event dump (-vv flag)
 *
 * Verbosity is controlled by the autopilot CLI's --verbose/-v flags,
 * which translate to GLRS_LOG_LEVEL env var before this module loads.
 */

import pino from "pino";
import type { Logger } from "pino";

/**
 * Resolve the log level from env. Defaults to "info" for autopilot,
 * giving the user iteration-level updates + exit reasons without the
 * per-tool-call heartbeat noise.
 */
function resolveLevel(): string {
  const env = process.env["GLRS_LOG_LEVEL"];
  if (env && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(env)) {
    return env;
  }
  return "info";
}

/**
 * Resolve the output format. Pretty-prints when stderr is a TTY, falls
 * back to JSON when piped. Explicit opt-out via GLRS_LOG_FORMAT=json.
 */
function shouldPrettyPrint(): boolean {
  if (process.env["GLRS_LOG_FORMAT"] === "json") return false;
  if (process.env["GLRS_LOG_FORMAT"] === "pretty") return true;
  return process.stderr.isTTY ?? false;
}

/**
 * Create a logger bound to a `component` field. Use one logger per
 * module so filtering by component is straightforward.
 *
 * Example: createLogger("autopilot.loop") → every log entry from
 * the Ralph loop is tagged `component: "autopilot.loop"`.
 */
export function createLogger(component: string): Logger {
  const level = resolveLevel();

  if (shouldPrettyPrint()) {
    return pino({
      level,
      base: { component },
      timestamp: pino.stdTimeFunctions.isoTime,
      transport: {
        target: "pino-pretty",
        options: {
          destination: 2, // stderr
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,component",
          messageFormat: "[{component}] {msg}",
        },
      },
    });
  }

  // JSON mode — write directly to stderr, no pretty transport
  return pino(
    {
      level,
      base: { component },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ fd: 2 }),
  );
}
