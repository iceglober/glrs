/**
 * Pilot v2 safety gate.
 *
 * Pre-flight checks before any pilot command modifies the working tree:
 * 1. Must be inside a git repo.
 * 2. Must NOT be on main/master/default branch.
 * 3. Working tree must be clean (no uncommitted changes), with tolerance
 *    for framework-owned paths that tools routinely modify without user intent.
 *
 * These are the same invariants as the old pilot v1 safety-gate.ts,
 * reimplemented cleanly for v2.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import picomatch from "picomatch";

const execFileP = promisify(execFile);

export type SafetyCheckResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; reason: string };

// Branches that are never safe to run pilot on.
const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

/**
 * Paths where "dirty" is framework noise, not user intent. Files that tools
 * outside pilot's control routinely rewrite without the user's say-so.
 * Dirt EXCLUSIVELY in these paths is tolerated; pilot proceeds with a warning.
 * Dirt outside them still refuses.
 */
const TOLERATED_PATHS: readonly string[] = [
  // OpenCode plugin installer churn — opencode upgrades its own plugin
  // dependency in the background, bumping .opencode/package.json + lockfile.
  ".opencode/**",
  // Next.js — `next build` regenerates this every run.
  "**/next-env.d.ts",
  // Next.js app-router generated types.
  "**/.next/types/**",
  "**/.next/dev/types/**",
  // TypeScript project-reference build info.
  "**/*.tsbuildinfo",
  // Snapshot test files rewritten by `vitest -u` / `jest -u`.
  "**/__snapshots__/**",
  "**/*.snap",
];

/**
 * Parse `git status --porcelain` output into file paths.
 * Porcelain v1 format: `XY <path>` (3-char prefix + path).
 * Renames: `XY <old> -> <new>` — take the new path.
 */
function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    let rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1);
    }
    paths.push(rest);
  }
  return paths;
}

/**
 * Run all pre-flight safety checks for the given working directory.
 * Returns { ok: true } if all pass, or { ok: false, reason } on first failure.
 */
export async function checkSafety(cwd: string): Promise<SafetyCheckResult> {
  // 1. Inside a git repo?
  try {
    await execFileP("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  } catch {
    return { ok: false, reason: "Not inside a git repository." };
  }

  // 2. Not on a protected branch?
  let branch: string;
  try {
    const { stdout } = await execFileP("git", ["branch", "--show-current"], { cwd });
    branch = stdout.trim();
  } catch {
    return { ok: false, reason: "Could not determine current branch." };
  }

  if (PROTECTED_BRANCHES.has(branch)) {
    return {
      ok: false,
      reason: `Refusing to run pilot on protected branch "${branch}". ` +
        `Create a feature branch first (e.g. git checkout -b feat/my-feature).`,
    };
  }

  // 3. Clean working tree (with tolerance for framework-owned paths)?
  let rawStatus: string;
  try {
    const { stdout } = await execFileP("git", ["status", "--porcelain"], { cwd });
    rawStatus = stdout.replace(/\n$/, "");
  } catch {
    return { ok: false, reason: "Could not check working tree status." };
  }

  if (rawStatus.length === 0) {
    return { ok: true };
  }

  // Partition dirty files into tolerated (framework noise) vs genuine (user work).
  const paths = parsePorcelainPaths(rawStatus);
  const matchTolerate = picomatch([...TOLERATED_PATHS], { dot: true });
  const tolerated: string[] = [];
  const genuine: string[] = [];

  for (const p of paths) {
    if (matchTolerate(p)) tolerated.push(p);
    else genuine.push(p);
  }

  if (genuine.length > 0) {
    const lines = rawStatus.split("\n").slice(0, 5);
    const preview = lines.join("\n  ");
    return {
      ok: false,
      reason: `Working tree is dirty. Commit or stash changes before running pilot.\n  ${preview}`,
    };
  }

  // All dirt is in tolerated paths — proceed with a warning.
  const preview = tolerated.slice(0, 5);
  const suffix = tolerated.length > preview.length
    ? ` (+${tolerated.length - preview.length} more)`
    : "";
  const warnings = [
    `Ignoring ${tolerated.length} modified file(s) in framework-owned paths:\n` +
      preview.map((p) => `  ${p}`).join("\n") + suffix,
  ];

  return { ok: true, warnings };
}

/**
 * Get the current HEAD SHA. Returns null if not in a git repo or no commits.
 */
export async function headSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
