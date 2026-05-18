/**
 * Shared type definitions for the scoper session.
 * Defined here (in autopilot) so both the autopilot orchestrator
 * (interactive.ts) and the CLI scoper command can import them without
 * creating circular dependencies.
 */

export interface ScoperSessionOptions {
  /** Directory where scope.md will be written. */
  planDir: string;
  /** Slug for the plan (used to name the subdirectory). */
  slug: string;
  /** The user's initial goal text (embedded in the first prompt). */
  initialGoal: string;
  /** Timeout in milliseconds per turn (default: 5 minutes). */
  timeoutMs?: number;
  /**
   * When provided, the scoper's initial prompt includes this plan content
   * so the scoper can ground its questions in the existing plan.
   */
  existingPlanContent?: string;
  /**
   * Injectable dependencies for testing.
   * @internal — concrete types are defined in the CLI's scoper.ts
   */
  _deps?: Record<string, unknown>;
}

export interface ScoperSessionResult {
  scopePath: string;
}
