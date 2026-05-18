/**
 * Extract actionable error details from OpenCode server logs.
 *
 * When the SSE `session.error` event carries only a generic "session error"
 * message, the real error (credential failure, model not found, etc.) is
 * only in the OpenCode server's own log at ~/.local/share/opencode/log/.
 *
 * This module reads the most recent log file and extracts the last
 * session.processor error line — which contains the actual provider error.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const OPENCODE_LOG_DIR = join(homedir(), ".local", "share", "opencode", "log");

/**
 * Read the most recent OpenCode server log and extract the last
 * session.processor error message. Returns null if no log found
 * or no error extracted.
 *
 * This is best-effort — the log directory may not exist, the log
 * format may change, or the error may not be present. Callers
 * should fall back to the generic message when this returns null.
 */
export function extractServerError(): string | null {
  try {
    const entries = readdirSync(OPENCODE_LOG_DIR)
      .filter((f) => f.endsWith(".log"))
      .sort()
      .reverse(); // most recent first (ISO timestamp filenames sort correctly)

    if (entries.length === 0) return null;

    const logPath = join(OPENCODE_LOG_DIR, entries[0]);
    const content = readFileSync(logPath, "utf-8");

    // Look for session.processor error lines — these carry the real
    // provider error (credential failure, model not found, etc.)
    // Format: ERROR ... service=session.processor ... error=<message>
    const lines = content.split("\n").reverse();
    for (const line of lines) {
      if (line.includes("service=session.processor") && line.includes("error=")) {
        const match = line.match(/error=(.+?)(?:\s+stack=|$)/);
        if (match) return match[1].trim();
      }
      // Also catch LLM-level errors
      if (line.includes("service=llm") && line.includes("error=")) {
        // Skip the generic {"error":{}} lines — those are useless
        if (line.includes('error={"error":{}}')) continue;
        const match = line.match(/error=(.+?)(?:\s+stream|$)/);
        if (match) return match[1].trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Enhance a generic "session error" message with details from the
 * OpenCode server log. If the log contains a more specific error,
 * returns that. Otherwise returns the original message unchanged.
 */
export function enhanceSessionError(genericMessage: string): string {
  // Only enhance truly generic messages — if the message already
  // contains useful info, don't overwrite it.
  if (genericMessage !== "session error" && genericMessage.length > 20) {
    return genericMessage;
  }
  const detail = extractServerError();
  if (detail) return detail;
  return genericMessage;
}
