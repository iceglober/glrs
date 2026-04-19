import fs from "node:fs";
import path from "node:path";
import {
  defaultBranchIn,
  gitIn,
  gitInSafe,
  gitRoot,
} from "./git.js";
import { worktreePath, repoName } from "./config.js";
import { registerWorktree } from "./registry.js";
import { runHook } from "./hooks.js";
import { ok, info, warn, bold } from "./fmt.js";

export interface CreateOptions {
  /** Branch/worktree slug. Auto-generated if omitted. */
  name?: string;
  /** Base branch to fork from. Defaults to the remote default branch. */
  from?: string;
  /** Absolute path to the source repo (for creating from outside one). */
  repoPath?: string;
  /** Override the repo name used for storage. Defaults to basename(repoPath). */
  repo?: string;
}

export interface CreateResult {
  wtPath: string;
  name: string;
  base: string;
}

/**
 * Generate a short, ordered slug: wt-YYMMDD-HHMMSS-xxx
 * The trailing 3-char suffix prevents collisions when invoked
 * in rapid succession (e.g. scripted).
 */
export function autoName(
  now: Date = new Date(),
  suffix: string = randomSuffix(),
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yy = now.getFullYear().toString().slice(2);
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `wt-${yy}${mm}${dd}-${hh}${mi}${ss}-${suffix}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 5).padEnd(3, "0");
}

/** Create a worktree with a new branch. Does NOT spawn a shell. */
export function createWorktree(opts: CreateOptions = {}): CreateResult {
  const srcRepo = opts.repoPath ?? gitRoot();
  const repo = opts.repo ?? path.basename(srcRepo);
  const name = opts.name ?? autoName();
  const wtPath = worktreePath(name, repo);

  if (fs.existsSync(wtPath)) {
    throw new Error(`Worktree already exists: ${wtPath}`);
  }
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });

  const base = opts.from ?? defaultBranchIn(srcRepo);

  info(`fetching origin/${base}...`);
  gitIn(srcRepo, "fetch", "origin", base, "--quiet");

  // Reset stale local branch if one exists
  const branchExists =
    gitInSafe(srcRepo, "show-ref", "--verify", `refs/heads/${name}`) !== null;
  if (branchExists) {
    warn(`branch ${bold(name)} already exists, resetting to origin/${base}`);
    gitIn(srcRepo, "branch", "-D", name);
  }

  info(`creating worktree ${bold(name)} from origin/${base}...`);
  gitIn(
    srcRepo,
    "worktree",
    "add",
    "-b",
    name,
    wtPath,
    `origin/${base}`,
    "--quiet",
  );

  // Best-effort upstream tracking
  try {
    gitIn(wtPath, "branch", "--set-upstream-to", `origin/${base}`, name);
  } catch {}

  runHook("post_create", {
    WORKTREE_DIR: wtPath,
    WORKTREE_NAME: name,
    BASE_BRANCH: base,
    REPO_ROOT: srcRepo,
  });

  registerWorktree({
    repo,
    repoPath: srcRepo,
    wtPath,
    branch: name,
    createdAt: new Date().toISOString(),
  });

  ok(`worktree created at ${bold(wtPath)}`);
  return { wtPath, name, base };
}

/** Create a worktree or return the existing path if it already exists. */
export function ensureWorktree(name: string, from?: string): string {
  const repo = repoName();
  const wtPath = worktreePath(name, repo);
  if (fs.existsSync(wtPath)) {
    info(`worktree already exists at ${bold(wtPath)}, reusing...`);
    registerWorktree({
      repo,
      repoPath: gitRoot(),
      wtPath,
      branch: name,
      createdAt: new Date().toISOString(),
    });
    return wtPath;
  }
  return createWorktree({ name, from }).wtPath;
}

