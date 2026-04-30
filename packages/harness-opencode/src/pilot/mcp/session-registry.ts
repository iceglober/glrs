/**
 * Session registry for the pilot MCP status server.
 *
 * Maintains a JSON file mapping sessionId -> { runId, taskId, dbPath }
 * under the run directory. Used by the MCP server to route incoming
 * status update calls to the correct task context.
 *
 * The file is canonically JSON, one top-level object, safe to read
 * concurrently. Writes use atomic rename (write to temp, then rename).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// --- Types -----------------------------------------------------------------

export type SessionEntry = {
  runId: string;
  taskId: string;
};

export type SessionsRegistry = Record<string, SessionEntry>;

// --- Public API ------------------------------------------------------------

/**
 * Get the path to the sessions.json file for a given run directory.
 */
export function getSessionsPath(runDir: string): string {
  return path.join(runDir, "sessions.json");
}

/**
 * Read the sessions registry from disk.
 *
 * Returns an empty object if the file doesn't exist or is malformed.
 * This is safe for concurrent reads (the file is only ever replaced
 * atomically, never modified in place).
 */
export function readSessions(runDir: string): SessionsRegistry {
  const sessionsPath = getSessionsPath(runDir);
  try {
    const content = fs.readFileSync(sessionsPath, "utf8");
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return parsed as SessionsRegistry;
  } catch {
    // File doesn't exist or is malformed — return empty registry.
    return {};
  }
}

/**
 * Register a session in the registry.
 *
 * Writes atomically using temp file + rename. Creates parent directories
 * if needed.
 */
export async function registerSession(args: {
  runDir: string;
  sessionId: string;
  runId: string;
  taskId: string;
}): Promise<void> {
  const { runDir, sessionId, runId, taskId } = args;
  const sessionsPath = getSessionsPath(runDir);

  // Ensure parent directory exists
  await mkdir(runDir, { recursive: true });

  // Read current state (may be empty)
  const current = readSessions(runDir);

  // Add new entry
  const updated: SessionsRegistry = {
    ...current,
    [sessionId]: { runId, taskId },
  };

  // Atomic write — use pid + random suffix to avoid collisions between
  // concurrent calls from the same process.
  const tempPath = `${sessionsPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempPath, JSON.stringify(updated, null, 2), "utf8");
  await rename(tempPath, sessionsPath);
}

/**
 * Unregister a session from the registry.
 *
 * Removes the entry for the given sessionId. If the sessionId doesn't
 * exist, this is a no-op. Writes atomically.
 */
export async function unregisterSession(args: {
  runDir: string;
  sessionId: string;
}): Promise<void> {
  const { runDir, sessionId } = args;
  const sessionsPath = getSessionsPath(runDir);

  // Read current state
  const current = readSessions(runDir);

  // If session doesn't exist, nothing to do
  if (!(sessionId in current)) {
    return;
  }

  // Remove entry
  const { [sessionId]: _, ...rest } = current;

  // Atomic write
  const tempPath = `${sessionsPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempPath, JSON.stringify(rest, null, 2), "utf8");
  await rename(tempPath, sessionsPath);
}

/**
 * Look up a session entry by sessionId.
 *
 * Returns undefined if not found.
 */
export function lookupSession(
  runDir: string,
  sessionId: string,
): SessionEntry | undefined {
  const registry = readSessions(runDir);
  return registry[sessionId];
}

/**
 * Clean up orphaned temp files that may have been left behind by
 * crashed processes. Safe to call at startup.
 */
export async function cleanupTempFiles(runDir: string): Promise<void> {
  const sessionsPath = getSessionsPath(runDir);
  const dir = path.dirname(sessionsPath);

  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      if (entry.startsWith("sessions.json.tmp.")) {
        try {
          await unlink(path.join(dir, entry));
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Directory may not exist yet
  }
}
