/**
 * Structured logger for the autopilot CLI.
 *
 * Single sink: **file** at trace level (captures everything, always).
 *   JSON — files are for grep/telemetry/debugging, not eyes.
 *   Default path: `<cwd>/.agent/autopilot-logs/<ISO-timestamp>.log`.
 *   Override via GLRS_AUTOPILOT_LOG_FILE=<path> or "off" to disable.
 *
 * User-facing output goes to stderr via plain `process.stderr.write`
 * in the calling code (TUI-style). Pino does NOT write to stderr —
 * the two channels are separate by design.
 *
 * Environment variables:
 *   - GLRS_AUTOPILOT_LOG_FILE: explicit path, or "off" to disable file sink
 */

import pino from "pino";
import type { Logger, MultiStreamRes, StreamEntry } from "pino";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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
 * Create the autopilot logger with file sink only.
 * Call ONCE per autopilot run. Pass `cwd` so the default file path
 * resolves relative to the user's project.
 *
 * User-facing output goes to stderr via process.stderr.write in the
 * calling code. Pino is for structured file logging only.
 *
 * @deprecated The autopilot code path now uses the typed SessionEvent stream
 * (session-events.ts + event-stream.ts) instead of pino for user-visible output.
 * This function is kept for non-autopilot consumers and as a verbose debug
 * channel inside the loop engine. New code should use SessionRunner + EventStreamWriter.
 */
export function createAutopilotLogger(opts: { cwd: string }): AutopilotLogger {
  const fileSink = buildFileStream(opts.cwd);

  const streams: StreamEntry[] = [];
  if (fileSink) streams.push(fileSink.entry);

  // If no file sink (disabled via env), create a silent logger that
  // still satisfies the interface but writes nothing.
  if (streams.length === 0) {
    const root = pino({ level: "silent" });
    return { root, logFilePath: null, flush: async () => {} };
  }

  const ms: MultiStreamRes = pino.multistream(streams);

  const root = pino(
    {
      level: "trace", // file sink captures everything
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    ms,
  );

  const flush = async (): Promise<void> => {
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
