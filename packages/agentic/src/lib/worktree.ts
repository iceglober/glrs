import fs from "node:fs";
import { git, defaultBranch, gitRoot } from "./git.js";
import { worktreePath, repoName } from "./config.js";
import { registerWorktree } from "./registry.js";
import { runHook } from "./hooks.js";
import { ok, info, bold } from "./fmt.js";

export interface CreateResult {
  wtPath: string;
  name: string;
  base: string;
}

/** Create a worktree with a new branch. Does NOT spawn a shell. */
export function createWorktree(
  name: string,
  from?: string,
): CreateResult {
  const base = from ?? defaultBranch();
  const wtPath = worktreePath(name);

  if (fs.existsSync(wtPath)) {
    throw new Error(`Worktree already exists: ${wtPath}`);
  }

  info(`fetching origin/${base}...`);
  git("fetch", "origin", base, "--quiet");

  info(`creating worktree ${bold(name)} from ${base}...`);
  git("worktree", "add", "-b", name, wtPath, `origin/${base}`, "--quiet");

  // Set upstream tracking (best-effort)
  try {
    git("-C", wtPath, "branch", "--set-upstream-to", `origin/${base}`, name);
  } catch {}

  runHook("post_create", {
    WORKTREE_DIR: wtPath,
    WORKTREE_NAME: name,
    BASE_BRANCH: base,
    REPO_ROOT: gitRoot(),
  });

  registerWorktree({
    repo: repoName(),
    repoPath: gitRoot(),
    wtPath,
    branch: name,
    createdAt: new Date().toISOString(),
  });

  ok(`worktree created at ${bold(wtPath)}`);
  return { wtPath, name, base };
}

/** Create a worktree or return the existing path if it already exists. */
export function ensureWorktree(name: string, from?: string): string {
  const wtPath = worktreePath(name);
  if (fs.existsSync(wtPath)) {
    info(`worktree already exists at ${bold(wtPath)}, reusing...`);
    registerWorktree({
      repo: repoName(),
      repoPath: gitRoot(),
      wtPath,
      branch: name,
      createdAt: new Date().toISOString(),
    });
    return wtPath;
  }
  return createWorktree(name, from).wtPath;
}
