/**
 * Repo-level pilot configuration — `.glrs/pilot.json`.
 *
 * Provides project-wide verification commands that apply to EVERY plan
 * without the planner having to reinvent them per-plan. The file lives
 * in the repo root (version-controlled, reviewable).
 *
 * Schema:
 *
 * ```json
 * {
 *   "baseline": ["pnpm typecheck", "pnpm lint"],
 *   "after_each": ["pnpm typecheck"]
 * }
 * ```
 *
 * - `baseline`: commands run once at the start of each task, on the
 *   clean tree, BEFORE the agent starts. Must all pass. Catches
 *   pre-existing failures (wrong port, missing migration, cross-package
 *   type breakage from prior tasks). Merged with the task's own verify
 *   commands for the baseline check.
 *
 * - `after_each`: commands run after EVERY task's verify, in addition
 *   to the plan's `defaults.verify_after_each` and the task's own
 *   `verify:`. Catches cross-package breakage that per-task verify
 *   misses (e.g., a task passes its own package typecheck but breaks
 *   a downstream consumer).
 *
 * Both fields are optional. Missing file = no project-level commands.
 * Missing field = empty array.
 *
 * Merge order for after-each verification:
 *   1. Task's `verify:` (plan-authored, task-specific)
 *   2. Plan's `defaults.verify_after_each` (plan-authored, cross-task)
 *   3. Milestone's `verify` (plan-authored, milestone-scoped)
 *   4. pilot.json's `after_each` (repo-authored, project-wide)
 *
 * Merge order for baseline:
 *   All of the above, PLUS pilot.json's `baseline` commands.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export const PILOT_JSON_FILENAME = ".glrs/pilot.json";

export type PilotConfig = {
  /** Commands run on the clean tree before each task's agent starts. */
  baseline: readonly string[];
  /** Commands run after every task, in addition to plan-level verify. */
  after_each: readonly string[];
};

const EMPTY_CONFIG: PilotConfig = {
  baseline: [],
  after_each: [],
};

/**
 * Load `.glrs/pilot.json` from `cwd`. Returns the empty config if the
 * file is missing. Throws on malformed JSON or invalid shape (so the
 * user sees the error immediately, not deep in a task).
 */
export async function loadPilotConfig(cwd: string): Promise<PilotConfig> {
  const filePath = path.join(cwd, PILOT_JSON_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    // Missing file = no project-level config. Silent.
    return EMPTY_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${PILOT_JSON_FILENAME}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${PILOT_JSON_FILENAME}: expected a JSON object, got ${typeof parsed}`,
    );
  }

  const obj = parsed as Record<string, unknown>;

  const baseline = parseStringArray(obj, "baseline");
  const after_each = parseStringArray(obj, "after_each");

  return { baseline, after_each };
}

function parseStringArray(
  obj: Record<string, unknown>,
  key: string,
): readonly string[] {
  const val = obj[key];
  if (val === undefined || val === null) return [];
  if (!Array.isArray(val)) {
    throw new Error(
      `${PILOT_JSON_FILENAME}: "${key}" must be an array of strings, got ${typeof val}`,
    );
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== "string" || (val[i] as string).length === 0) {
      throw new Error(
        `${PILOT_JSON_FILENAME}: "${key}[${i}]" must be a non-empty string`,
      );
    }
  }
  return val as string[];
}
