/**
 * Sentinel detection for the Ralph loop autopilot engine.
 *
 * The agent emits `<autopilot-done>` as a standalone tag (not inside a
 * code fence or inline backtick) to signal that all work is complete.
 */

import { SENTINEL_TAG } from "./config.js";

/**
 * Returns true if the text contains the `<autopilot-done>` sentinel tag
 * outside of any code fence (``` ... ```) or inline backtick span.
 *
 * Detection rules:
 *   - Case-sensitive: `<AUTOPILOT-DONE>` does NOT match.
 *   - Tag inside a fenced code block (``` ... ```) does NOT match.
 *   - Tag inside an inline backtick span (` ... `) does NOT match.
 *   - Partial tags (`<autopilot-done` or `autopilot-done>`) do NOT match.
 */
export function detectSentinel(text: string): boolean {
  if (!text.includes(SENTINEL_TAG)) {
    return false;
  }

  // Strip fenced code blocks (``` ... ```) — greedy across newlines.
  // We replace them with empty strings so the sentinel inside them
  // becomes invisible.
  const withoutFences = text.replace(/```[\s\S]*?```/g, "");

  // Strip inline backtick spans (` ... `) — single-line only.
  const withoutInline = withoutFences.replace(/`[^`\n]*`/g, "");

  return withoutInline.includes(SENTINEL_TAG);
}
