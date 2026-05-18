/**
 * Session discovery — scan directories for autopilot event stream files.
 *
 * For each directory, checks for `.agent/autopilot-events.jsonl`.
 * Reads events, derives state, and marks sessions as stale when the last
 * event is older than 5 minutes and the session has no `session:done` event.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EventStreamReader } from "@glrs-dev/autopilot";
import { deriveState } from "@glrs-dev/autopilot";
import type { SessionHandle } from "@glrs-dev/autopilot";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_FILE_NAME = "autopilot-events.jsonl";
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredSession {
  eventFilePath: string;
  handle: SessionHandle;
  isStale: boolean;
}

// ---------------------------------------------------------------------------
// discoverSessions
// ---------------------------------------------------------------------------

/**
 * Scan `dirs` for `.agent/autopilot-events.jsonl` files.
 *
 * For each found file:
 * 1. Read all events and derive state.
 * 2. Mark stale if: last event > 5 min old AND status is not "complete".
 * 3. Return sorted by most recent activity (newest first).
 *
 * Silently skips directories that don't exist or have no event file.
 * Silently skips event files that produce no valid session (no session:start).
 */
export function discoverSessions(dirs: string[]): DiscoveredSession[] {
  const results: DiscoveredSession[] = [];
  const now = Date.now();

  for (const dir of dirs) {
    const eventFilePath = path.join(dir, ".agent", EVENT_FILE_NAME);

    // Skip if file doesn't exist
    if (!fs.existsSync(eventFilePath)) {
      continue;
    }

    let handle: SessionHandle | null;
    try {
      const reader = new EventStreamReader(eventFilePath);
      const events = reader.readAll();
      handle = deriveState(events);
    } catch {
      // Malformed or unreadable file — skip
      continue;
    }

    if (!handle) {
      // No session:start event found
      continue;
    }

    // Stale: last event > 5 min ago AND session is not complete
    const lastEventMs = new Date(handle.lastEventAt).getTime();
    const isStale =
      handle.status !== "complete" &&
      now - lastEventMs > STALE_THRESHOLD_MS;

    // If stale, update the status on the handle
    const finalHandle: SessionHandle = isStale
      ? { ...handle, status: "stale" }
      : handle;

    results.push({ eventFilePath, handle: finalHandle, isStale });
  }

  // Sort by most recent activity (newest first)
  results.sort(
    (a, b) =>
      new Date(b.handle.lastEventAt).getTime() -
      new Date(a.handle.lastEventAt).getTime(),
  );

  return results;
}
