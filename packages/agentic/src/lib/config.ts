import path from "node:path";
import os from "node:os";
import { gitRoot } from "./git.js";

const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "next",
  "prerelease",
]);

export function isProtected(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch);
}

/** Repo name derived from the git root directory. */
export function repoName(): string {
  return path.basename(gitRoot());
}

/** Root directory for all worktrees of a given repo. */
export function worktreesRoot(repo: string): string {
  const override = process.env.GLORIOUS_DIR;
  if (override) return path.resolve(override, repo);
  return path.join(os.homedir(), ".glorious", "worktrees", repo);
}

/**
 * Resolve where a worktree should live.
 *
 * Default: ~/.glorious/worktrees/<repo>/<name>
 * If GLORIOUS_DIR is set:  $GLORIOUS_DIR/<repo>/<name>
 */
export function worktreePath(name: string, repo?: string): string {
  const repoKey = repo ?? repoName();
  return path.join(worktreesRoot(repoKey), name);
}
