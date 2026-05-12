/**
 * Tool-call heartbeat: in-place counter lines grouped by contiguous tool streaks.
 *
 * While the same tool fires repeatedly, a single line updates in place via
 * carriage-return ("read x1" → "read x2" → "read x3"). When a different tool
 * fires, the current streak line is committed with a newline and a fresh
 * counter line starts for the new tool.
 *
 * TTY behavior: one in-place-updated line per streak.
 * Non-TTY behavior: every tool call emits its own newline-terminated line so
 * the log stays parseable when piped to a file or captured by CI.
 *
 * Decoupled from pino by design — pino's structured log model doesn't fit
 * in-place-updated progress lines. Iteration boundaries and exit events go
 * through pino separately; this module only handles the per-tool heartbeat.
 */

export interface HeartbeatOptions {
  /** Label printed before each heartbeat line (e.g. "autopilot:iter-3"). */
  label: string;
  /**
   * Force TTY/non-TTY behavior. Defaults to process.stderr.isTTY.
   * Exposed for tests.
   */
  isTTY?: boolean;
  /**
   * Write sink. Defaults to process.stderr.write. Exposed for tests.
   */
  write?: (s: string) => void;
}

export interface Heartbeat {
  /**
   * Record a tool call. If `name` matches the current streak, the line
   * is updated in place (TTY) or a new line is emitted (non-TTY). If
   * `name` differs, the current streak is flushed with a newline and a
   * new streak begins.
   */
  recordToolCall(name: string): void;
  /**
   * Flush any pending streak (emit the trailing newline). Call at end
   * of iteration or when handing off to non-heartbeat output.
   */
  flush(): void;
}

/**
 * ANSI escape to erase the current line (all of it), then return to
 * column 0. `\x1b[2K` = erase entire line; `\r` = move to col 0.
 * Equivalent to spinner libraries' clearLine + cursorTo(0).
 */
const CLEAR_LINE = "\x1b[2K\r";

export function createHeartbeat(opts: HeartbeatOptions): Heartbeat {
  const isTTY = opts.isTTY ?? process.stderr.isTTY ?? false;
  const write = opts.write ?? ((s: string) => process.stderr.write(s));
  const label = opts.label;

  // Streak state. Null means no streak in progress.
  let currentTool: string | null = null;
  let currentCount = 0;
  let lineOpen = false; // TTY only — whether the current line is mid-update

  function renderLine(tool: string, count: number): string {
    return `[${label}] ${tool} x${count}`;
  }

  function commitStreak(): void {
    if (!isTTY) return; // non-TTY already emitted per-call newlines
    if (lineOpen) {
      write("\n");
      lineOpen = false;
    }
  }

  return {
    recordToolCall(name: string): void {
      if (currentTool === name) {
        // Continuing streak
        currentCount++;
        if (isTTY) {
          // Overwrite the current line
          write(CLEAR_LINE + renderLine(name, currentCount));
        } else {
          // Every call is its own line
          write(renderLine(name, currentCount) + "\n");
        }
      } else {
        // New streak — commit any in-progress TTY line first
        commitStreak();
        currentTool = name;
        currentCount = 1;
        if (isTTY) {
          write(CLEAR_LINE + renderLine(name, currentCount));
          lineOpen = true;
        } else {
          write(renderLine(name, currentCount) + "\n");
        }
      }
    },

    flush(): void {
      commitStreak();
      currentTool = null;
      currentCount = 0;
    },
  };
}
