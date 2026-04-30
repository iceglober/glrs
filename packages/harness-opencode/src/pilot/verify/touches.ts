/**
 * Post-task touches enforcement — cwd mode.
 *
 * After a task's verify commands pass, the worker calls `enforceTouches`
 * to confirm the agent only edited files inside its declared `touches`
 * scope (plus a small default allowlist of framework-generated files,
 * plus the task's optional `tolerate` globs).
 *
 * Out-of-scope edits → mark task failed for manual recovery.
 *
 * Algorithm:
 *   1. Compute the diff names since `sinceSha` in `cwd`.
 *   2. Compile the union of `touches ∪ tolerate ∪ DEFAULT_TOLERATE` as
 *      the allowed set.
 *   3. Any file path not matched by any allowed glob is a violation.
 *   4. Empty `touches` + any diff = violation (the task is verify-only
 *      but the agent edited files anyway). DEFAULT_TOLERATE matches
 *      still don't count as "agent output" — they're accepted silently.
 *   5. No diff at all = ok (verify-only tasks pass cleanly).
 *
 * Why defaults exist: framework build/verify steps legitimately write
 * files outside the agent's declared touches (next-env.d.ts, lockfile
 * tweaks, snapshot updates). Hard-rejecting on these traps the run in
 * a fix-loop the agent can't escape — the file is written by the tool,
 * not the agent, and reverting it causes the next verify to re-create
 * it. The allowlist preempts these cases without per-plan boilerplate.
 *
 * Plan authors can extend the allowlist per-task via `tolerate:` for
 * project-specific codegen.
 */

import picomatch from "picomatch";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Globs always allowed in any task's diff — framework-generated files
 * that are written by the verify step itself (build, test), not the
 * agent. Kept small and opinionated: every entry here is load-bearing
 * for a common framework.
 *
 * If a project has custom codegen, the planner adds it to the task's
 * `tolerate:` field — NOT this list.
 */
export const DEFAULT_TOLERATE: readonly string[] = [
  // Next.js — `next build` regenerates this every run.
  "**/next-env.d.ts",
  // Next.js app-router generated types (routes.d.ts, etc.)
  "**/.next/types/**",
  "**/.next/dev/types/**",
  // TypeScript project-reference build info — tsc writes these.
  "**/*.tsbuildinfo",
  // Snapshot test updates — `vitest -u` / `jest -u` rewrites these
  // when assertions match; allowing them lets snapshot-driven tasks
  // pass without the agent authoring every snapshot path.
  "**/__snapshots__/**",
  "**/*.snap",
];

/**
 * List file paths that changed in `cwd` since `sinceSha`, including
 * uncommitted work. Union of:
 *   - committed changes: `git diff --name-only <sinceSha>..HEAD`
 *   - staged changes:    `git diff --cached --name-only`
 *   - unstaged changes:  `git diff --name-only`
 *   - untracked:         `git ls-files --others --exclude-standard`
 *
 * Deduped and sorted. Inlined from the removed `../worktree/git.ts`.
 */
async function diffNamesSince(
  cwd: string,
  sinceSha: string,
): Promise<string[]> {
  const run = async (args: string[]): Promise<string[]> => {
    for (const a of args) {
      if (a.includes("\0")) {
        throw new Error(`git arg contains null byte: ${JSON.stringify(a)}`);
      }
    }
    const { stdout } = await execFileP("git", ["-C", cwd, ...args], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const sets = await Promise.all([
    run(["diff", "--name-only", `${sinceSha}..HEAD`]),
    run(["diff", "--cached", "--name-only"]),
    run(["diff", "--name-only"]),
    run(["ls-files", "--others", "--exclude-standard"]),
  ]);

  const all = new Set<string>();
  for (const s of sets) for (const p of s) all.add(p);
  return [...all].sort();
}

// --- Public API ------------------------------------------------------------

export type TouchesResult =
  | { ok: true; changed: string[] }
  | { ok: false; changed: string[]; violators: string[] };

/**
 * Enforce that the changes in `cwd` since `sinceSha` only touched
 * files matched by `allowed` globs (union of the task's `touches`,
 * `tolerate`, and the built-in DEFAULT_TOLERATE).
 */
export async function enforceTouches(args: {
  cwd: string;
  sinceSha: string;
  /** Task's `touches:` — the files the agent was asked to edit. */
  allowed: ReadonlyArray<string>;
  /** Task's `tolerate:` — extra globs for project-specific codegen. */
  tolerate?: ReadonlyArray<string>;
}): Promise<TouchesResult> {
  const changed = await diffNamesSince(args.cwd, args.sinceSha);
  if (changed.length === 0) {
    return { ok: true, changed: [] };
  }

  const combined = [
    ...args.allowed,
    ...(args.tolerate ?? []),
    ...DEFAULT_TOLERATE,
  ];

  // Even with defaults, empty `touches` on a task that produced edits
  // is suspicious — the task is verify-only by declaration but the
  // agent (or build tool) wrote files. If EVERY changed path is in
  // tolerate/defaults, accept it; otherwise flag as violation.
  if (args.allowed.length === 0) {
    // Edge case: allow defaults/tolerate to cover the whole diff.
    const matchPassthrough = picomatch(
      [...(args.tolerate ?? []), ...DEFAULT_TOLERATE],
      { dot: true },
    );
    const violators = changed.filter((p) => !matchPassthrough(p));
    if (violators.length === 0) return { ok: true, changed };
    return { ok: false, changed, violators };
  }

  const matchAllowed = picomatch(combined, { dot: true });
  const violators = changed.filter((p) => !matchAllowed(p));
  if (violators.length === 0) return { ok: true, changed };
  return { ok: false, changed, violators };
}

/**
 * Pure (no-fs) variant of `enforceTouches` for tests. Does NOT apply
 * DEFAULT_TOLERATE — the caller is expected to build the full allowed
 * set themselves for explicit unit-test control.
 */
export function enforceTouchesPure(args: {
  changed: ReadonlyArray<string>;
  allowed: ReadonlyArray<string>;
}): TouchesResult {
  const changed = [...args.changed];
  if (changed.length === 0) return { ok: true, changed: [] };
  if (args.allowed.length === 0) {
    return { ok: false, changed, violators: changed };
  }
  const match = picomatch([...args.allowed], { dot: true });
  const violators = changed.filter((p) => !match(p));
  if (violators.length === 0) return { ok: true, changed };
  return { ok: false, changed, violators };
}
