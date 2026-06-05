/**
 * Tolerant parse for opencode-style config files.
 *
 * opencode loads its `opencode.json` with a JSONC parser, so trailing commas
 * and comments are valid there. The glrs CLI historically used strict
 * `JSON.parse`, which rejects those — so a config opencode accepts could wedge
 * `harness install`/`configure` and make `doctor` falsely report "invalid
 * JSON". This parses strict JSON first (the fast, common path) and falls back
 * to JSON5 only on failure, matching what opencode tolerates. A genuinely
 * malformed file still throws — and we re-throw the stricter JSON error, which
 * usually points at the real problem more clearly than JSON5's.
 */
import JSON5 from "json5";

export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (strictErr) {
    try {
      return JSON5.parse(text);
    } catch {
      throw strictErr;
    }
  }
}
