/**
 * Structured logger for the autopilot CLI.
 *
 * Two sinks via pino.multistream:
 *
 *   1. **stderr** at configurable level (default: info).
 *        Pretty-printed when stderr is a TTY (via pino-pretty's
 *        programmatic API piped to process.stderr). JSON otherwise.
 *        This is what the user sees live during an autopilot run.
 *
 *   2. **File sink** at trace level (captures everything, always).
 *        JSON regardless of TTY — files are for grep, not eyes.
 *        Default path: `<cwd>/.agent/autopilot-logs/<ISO-timestamp>.log`.
 *        Override via GLRS_AUTOPILOT_LOG_FILE=<path> or "off" to disable.
 *
 * Environment variables:
 *   - GLRS_LOG_LEVEL: stderr level (fatal|error|warn|info|debug|trace|silent)
 *                     Default: info
 *   - GLRS_LOG_FORMAT: pretty | json | <unset> (auto-detect from TTY)
 *   - GLRS_AUTOPILOT_LOG_FILE: explicit path, or "off" to disable file sink
 *
 * A single logger instance serves the whole autopilot run. Iteration-level
 * events are info; per-tool-call events are debug (hidden from stderr by
 * default, always captured to file).
 */

import pino from "pino";
import type { Logger, MultiStreamRes, StreamEntry } from "pino";
import PinoPretty from "pino-pretty";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve the stderr log level from env. Defaults to "info".
 */
function resolveStderrLevel(): string {
  const env = process.env["GLRS_LOG_LEVEL"];
  if (env && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(env)) {
    return env;
  }
  return "info";
}

/**
 * Whether to pretty-print stderr output. Defaults to the TTY state of
 * stderr; overridable via GLRS_LOG_FORMAT.
 */
function shouldPrettyPrint(): boolean {
  if (process.env["GLRS_LOG_FORMAT"] === "json") return false;
  if (process.env["GLRS_LOG_FORMAT"] === "pretty") return true;
  return process.stderr.isTTY ?? false;
}

/**
 * Resolve the file log path. Returns null when file logging is disabled.
 */
function resolveLogFilePath(cwd: string): string | null {
  const env = process.env["GLRS_AUTOPILOT_LOG_FILE"];
  if (env === "off") return null;
  if (env) return env;
  // Default: <cwd>/.agent/autopilot-logs/<timestamp>.log
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(cwd, ".agent", "autopilot-logs", `${timestamp}.log`);
}

/**
 * Build the stderr stream entry. Pretty-prints if TTY; otherwise JSON.
 */
function buildStderrStream(level: string): StreamEntry {
  if (shouldPrettyPrint()) {
    const pretty = PinoPretty({
      colorize: true,
      translateTime: "HH:MM:ss.l",
      ignore: "pid,hostname,component",
      messageFormat: "[{component}] {msg}",
      destination: 2, // stderr
    });
    return { level: level as pino.Level, stream: pretty };
  }
  return {
    level: level as pino.Level,
    stream: pino.destination({ fd: 2, sync: false }),
  };
}

/**
 * Build the file stream entry. Creates the parent directory if needed.
 * Returns null when file logging is disabled.
 */
function buildFileStream(cwd: string): { entry: StreamEntry; path: string } | null {
  const filePath = resolveLogFilePath(cwd);
  if (!filePath) return null;

  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }

  return {
    path: filePath,
    entry: {
      level: "trace" as pino.Level,
      // sync: true gives deterministic flushSync semantics so the file
      // log is safe to read immediately after flush() returns (critical
      // for tests and for reliable postmortem after a crash). Autopilot
      // runs are long-lived enough that sync writes aren't a bottleneck.
      stream: pino.destination({ dest: filePath, sync: true, mkdir: true }),
    },
  };
}

/**
 * Per-run logger state. Created once per autopilot invocation.
 */
export interface AutopilotLogger {
  /** The pino root logger. Call .child({ component }) for module-level loggers. */
  root: Logger;
  /** Path to the file log sink, if enabled. */
  logFilePath: string | null;
  /** Flush all streams. Call before process exit. */
  flush: () => Promise<void>;
}

/**
 * Create the autopilot logger with both stderr and file sinks.
 * Call ONCE per autopilot run. Pass `cwd` so the default file path
 * resolves relative to the user's project.
 */
export function createAutopilotLogger(opts: { cwd: string }): AutopilotLogger {
  const stderrLevel = resolveStderrLevel();
  const fileSink = buildFileStream(opts.cwd);

  const streams: StreamEntry[] = [buildStderrStream(stderrLevel)];
  if (fileSink) streams.push(fileSink.entry);

  // multistream lets us fan out with per-stream levels. minLevel must be
  // the most permissive (trace) so the router sees all events and filters
  // per stream.
  const ms: MultiStreamRes = pino.multistream(streams);

  const root = pino(
    {
      level: "trace", // router gate; individual streams apply their own levels
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    ms,
  );

  const flush = async (): Promise<void> => {
    // pino.destination streams have flushSync; use ms.flushSync for safety.
    try {
      ms.flushSync();
    } catch {
      // Best-effort flush on shutdown
    }
  };

  return {
    root,
    logFilePath: fileSink?.path ?? null,
    flush,
  };
}

/**
 * Convenience factory for module-level loggers when the root logger is
 * already created. Use this inside modules that receive a root logger
 * from the caller:
 *
 *   const log = childLogger(root, "autopilot.loop");
 *   log.info("hello");  // emits with component: "autopilot.loop"
 */
export function childLogger(root: Logger, component: string): Logger {
  return root.child({ component });
}
