/**
 * Tests for the tool-call heartbeat accumulator.
 *
 * Verifies:
 *   - Contiguous same-tool calls update in place (TTY) or emit per-call (non-TTY)
 *   - Different tools commit the current streak and start a new one
 *   - flush() emits the trailing newline for an in-progress TTY streak
 *   - flush() is a no-op in non-TTY mode (already newline-terminated)
 */

import { describe, it, expect } from "bun:test";
import { createHeartbeat } from "../src/autopilot/heartbeat.js";

describe("heartbeat", () => {
  describe("TTY mode (in-place update)", () => {
    it("single tool streak updates in place", () => {
      const out: string[] = [];
      const hb = createHeartbeat({
        label: "iter-1",
        isTTY: true,
        write: (s) => out.push(s),
      });

      hb.recordToolCall("read");
      hb.recordToolCall("read");
      hb.recordToolCall("read");
      hb.flush();

      // Three in-place updates + one newline on flush
      expect(out).toEqual([
        "\x1b[2K\r[iter-1] read x1",
        "\x1b[2K\r[iter-1] read x2",
        "\x1b[2K\r[iter-1] read x3",
        "\n",
      ]);
    });

    it("different tool commits previous streak and starts new one", () => {
      const out: string[] = [];
      const hb = createHeartbeat({
        label: "iter-2",
        isTTY: true,
        write: (s) => out.push(s),
      });

      hb.recordToolCall("read");
      hb.recordToolCall("read");
      hb.recordToolCall("write"); // transition
      hb.flush();

      // read x1, read x2, newline (committing read streak), write x1, newline (flush)
      expect(out).toEqual([
        "\x1b[2K\r[iter-2] read x1",
        "\x1b[2K\r[iter-2] read x2",
        "\n",
        "\x1b[2K\r[iter-2] write x1",
        "\n",
      ]);
    });

    it("alternating tools produce one line per streak", () => {
      const out: string[] = [];
      const hb = createHeartbeat({
        label: "iter-3",
        isTTY: true,
        write: (s) => out.push(s),
      });

      hb.recordToolCall("read");
      hb.recordToolCall("write");
      hb.recordToolCall("read"); // same name as first but streak was broken
      hb.flush();

      // Three independent streaks of 1 each
      expect(out).toEqual([
        "\x1b[2K\r[iter-3] read x1",
        "\n",
        "\x1b[2K\r[iter-3] write x1",
        "\n",
        "\x1b[2K\r[iter-3] read x1",
        "\n",
      ]);
    });

    it("flush with no pending streak is a no-op", () => {
      const out: string[] = [];
      const hb = createHeartbeat({
        label: "iter-4",
        isTTY: true,
        write: (s) => out.push(s),
      });

      hb.flush();

      expect(out).toEqual([]);
    });
  });

  describe("non-TTY mode (newline per call)", () => {
    it("every call emits its own line", () => {
      const out: string[] = [];
      const hb = createHeartbeat({
        label: "iter-1",
        isTTY: false,
        write: (s) => out.push(s),
      });

      hb.recordToolCall("read");
      hb.recordToolCall("read");
      hb.recordToolCall("read");
      hb.flush();

      // Three independent lines, no in-place update, no flush newline
      expect(out).toEqual([
        "[iter-1] read x1\n",
        "[iter-1] read x2\n",
        "[iter-1] read x3\n",
      ]);
    });

    it("counter continues across calls within a streak", () => {
      const out: string[] = [];
      const hb = createHeartbeat({
        label: "iter-2",
        isTTY: false,
        write: (s) => out.push(s),
      });

      hb.recordToolCall("read");
      hb.recordToolCall("read");
      hb.recordToolCall("write"); // new streak
      hb.recordToolCall("write");

      expect(out).toEqual([
        "[iter-2] read x1\n",
        "[iter-2] read x2\n",
        "[iter-2] write x1\n",
        "[iter-2] write x2\n",
      ]);
    });
  });
});
