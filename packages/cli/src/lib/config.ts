import * as path from "node:path";
import * as os from "node:os";
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
  const override = process.env.GLRS_DIR ?? process.env.GLORIOUS_DIR;
  if (override) return path.resolve(override, repo);
  return path.join(os.homedir(), ".glrs", "worktrees", repo);
}

/**
 * Resolve where a worktree should live.
 *
 * Default: ~/.glrs/worktrees/<repo>/<name>
 * If GLRS_DIR is set:  $GLRS_DIR/<repo>/<name>
 * If GLORIOUS_DIR is set (legacy):  $GLORIOUS_DIR/<repo>/<name>
 */
export function worktreePath(name: string, repo?: string): string {
  const repoKey = repo ?? repoName();
  return path.join(worktreesRoot(repoKey), name);
}
