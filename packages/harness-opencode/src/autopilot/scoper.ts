/**
 * Scoper session runner for the interactive autopilot orchestrator.
 *
 * Runs an opencode session with the @scoper agent, watches for the
 * `SCOPE_COMPLETE: <path>` sentinel in stdout, and returns the
 * scope.md path.
 */

/**
 * Extract the scope.md path from the SCOPE_COMPLETE sentinel line.
 * Returns the path string, or null if no sentinel is found.
 *
 * Uses the LAST occurrence if multiple sentinel lines appear (the
 * agent may emit intermediate progress lines before the final one).
 */
export function extractScopeCompletePath(output: string): string | null {
  const lines = output.split("\n");
  let lastMatch: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("SCOPE_COMPLETE:")) {
      const rest = trimmed.slice("SCOPE_COMPLETE:".length).trim();
      if (rest.length > 0) {
        lastMatch = rest;
      }
    }
  }

  return lastMatch;
}

export interface ScoperSessionOptions {
  /** Directory where scope.md will be written. */
  planDir: string;
  /** Slug for the plan (used to name the subdirectory). */
  slug: string;
  /** Timeout in milliseconds (default: 15 minutes). */
  timeoutMs?: number;
}

export interface ScoperSessionResult {
  scopePath: string;
}
