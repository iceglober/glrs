import path from "node:path";
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

/**
 * Resolve where a worktree should live.
 *
 * - If AFLOW_DIR is set: AFLOW_DIR/<name>
 * - Otherwise: ../<repo>-wt-<name> (sibling of the repo)
 */
export function worktreePath(name: string): string {
  const wtmDir = process.env.GLORIOUS_DIR;
  if (wtmDir) {
    return path.resolve(wtmDir, name);
  }
  const root = gitRoot();
  return path.resolve(path.dirname(root), `${repoName()}-wt-${name}`);
}
