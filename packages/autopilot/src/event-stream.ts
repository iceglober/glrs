/**
 * NDJSON event stream writer and reader for the autopilot event stream.
 *
 * Channel 2: .agent/autopilot-events.jsonl
 *
 * Writer: append-only, sync writes (crash-safe).
 * Reader: full read or tail mode (byte offset).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionEvent } from "./session-events.js";

// ---------------------------------------------------------------------------
// EventStreamWriter
// ---------------------------------------------------------------------------

/**
 * Append-only NDJSON writer. Opens the file for append on construction,
 * writes each event as a JSON line synchronously (crash-safe), and closes
 * the file descriptor on `close()`.
 */
export class EventStreamWriter {
  private fd: number;

  constructor(filePath: string) {
    // Ensure the parent directory exists
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Open for append (creates if missing)
    this.fd = fs.openSync(filePath, "a");
  }

  /**
   * Serialize `event` as a JSON line and write it synchronously.
   * Sync write ensures the line is on disk even if the process crashes
   * immediately after.
   */
  emit(event: SessionEvent): void {
    const line = JSON.stringify(event) + "\n";
    const buf = Buffer.from(line, "utf8");
    fs.writeSync(this.fd, buf);
  }

  /**
   * Close the underlying file descriptor. Safe to call multiple times
   * (subsequent calls are no-ops).
   */
  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      // Already closed — ignore
    }
  }
}

// ---------------------------------------------------------------------------
// EventStreamReader
// ---------------------------------------------------------------------------

/**
 * NDJSON reader for the autopilot event stream.
 *
 * Supports full reads and tail mode (byte offset). Truncated or malformed
 * last lines are silently skipped — they indicate a crash mid-write.
 */
export class EventStreamReader {
  constructor(private readonly filePath: string) {}

  /**
   * Read all events from the file. Returns an empty array if the file
   * does not exist or is empty.
   */
  readAll(): SessionEvent[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return [];
    }
    return parseLines(raw);
  }

  /**
   * Read events starting at `byteOffset`. Returns the parsed events and
   * the new byte offset (= file size after reading). Useful for polling
   * (tail mode): pass the returned `newOffset` on the next call to read
   * only new events.
   *
   * Truncated or malformed last lines are skipped.
   */
  readFrom(byteOffset: number): { events: SessionEvent[]; newOffset: number } {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      return { events: [], newOffset: byteOffset };
    }

    const fileSize = stat.size;
    if (fileSize <= byteOffset) {
      return { events: [], newOffset: byteOffset };
    }

    const length = fileSize - byteOffset;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(this.filePath, "r");
    try {
      fs.readSync(fd, buf, 0, length, byteOffset);
    } finally {
      fs.closeSync(fd);
    }

    const raw = buf.toString("utf8");
    const events = parseLines(raw);
    return { events, newOffset: fileSize };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse NDJSON text into SessionEvent[]. Skips blank lines and lines that
 * fail JSON.parse (e.g., a truncated last line from a crash mid-write).
 */
function parseLines(raw: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SessionEvent;
      events.push(parsed);
    } catch {
      // Truncated or malformed line — skip silently
    }
  }
  return events;
}
