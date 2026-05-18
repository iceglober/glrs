/**
 * Scope-validator module for the autopilot (item 4.2).
 *
 * After each iteration, the orchestrator compares the files the agent
 * actually touched (`git diff --name-only <baseRef>`) against the
 * union of files declared in the current phase's plan-state items
 * (`PlanItem.files[]`). Mismatches are logged as warnings:
 *
 *   - extra: agent edited a file NOT in the plan → "Scope drift"
 *   - missing: plan expects a file but the agent didn't touch it → "Incomplete"
 *
 * Validation is informational — it never blocks the loop. Both arrays
 * may be empty on a clean iteration.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCb);

export interface ScopeValidation {
  /** Files the agent edited that are NOT in the expected list (scope drift). */
  extra: string[];
  /** Files the expected list contains but the agent did NOT edit (incomplete). */
  missing: string[];
}

/**
 * Compare two file lists and return the symmetric differences.
 *
 * Both inputs are normalized — duplicates removed, sorted alphabetically.
 * Path comparison is exact (no canonicalization); callers should pass
 * paths in the same form (e.g. all relative-to-cwd).
 */
export function validateScope(
  expected: string[],
  actual: string[],
): ScopeValidation {
  const expectedSet = new Set(expected.filter((p) => p && p.trim()));
  const actualSet = new Set(actual.filter((p) => p && p.trim()));

  const extra: string[] = [];
  for (const f of actualSet) {
    if (!expectedSet.has(f)) extra.push(f);
  }

  const missing: string[] = [];
  for (const f of expectedSet) {
    if (!actualSet.has(f)) missing.push(f);
  }

  extra.sort();
  missing.sort();
  return { extra, missing };
}

export interface GetChangedFilesOptions {
  /**
   * Test-only: inject execFile replacement.
   * @internal
   */
  _deps?: {
    execFile?: typeof execFileDefault;
  };
}

/**
 * Return the list of files changed in `cwd` since `baseRef` (a git SHA
 * or ref). Uses `git diff --name-only` so committed AND uncommitted
 * working-tree changes both count.
 *
 * Never throws — degrades to `[]` on git failure so callers can treat
 * "git unavailable" the same as "no files changed".
 */
export async function getChangedFiles(
  cwd: string,
  baseRef: string,
  opts: GetChangedFilesOptions = {},
): Promise<string[]> {
  const execFile = opts._deps?.execFile ?? execFileDefault;
  try {
    const { stdout } = await execFile(
      "git",
      ["diff", "--name-only", baseRef],
      { cwd },
    );
    const text = typeof stdout === "string" ? stdout : String(stdout ?? "");
    return text
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
