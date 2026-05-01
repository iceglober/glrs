import * as path from "node:path";
import { existsSync as fsExistsSync, mkdirSync as fsMkdirSync } from "node:fs";
import {
  defaultBranchIn,
  gitIn,
  gitInSafe,
  gitRoot,
} from "./git.js";
import { worktreePath, repoName } from "./config.js";
import { registerWorktree } from "./registry.js";
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

function existsSync(filePath: string): boolean {
  return fsExistsSync(filePath);
}

function mkdirSync(dirPath: string, opts?: { recursive?: boolean }): void {
  fsMkdirSync(dirPath, opts);
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

/**
 * Refuse to create a worktree from a linked worktree. Nested worktrees break
 * path resolution (storage lands under `<worktree>/<name>/` instead of
 * `<repo>/<name>/`) and leave stale branch metadata attached to the wrong
 * clone. `git rev-parse --git-common-dir` returns an absolute path outside
 * `srcRepo` whenever srcRepo is itself a linked worktree.
 */
export function assertPrimaryClone(srcRepo: string): void {
  const commonDir = gitInSafe(srcRepo, "rev-parse", "--git-common-dir");
  if (!commonDir) return; // not a git repo yet — let the later git call error
  if (!path.isAbsolute(commonDir)) return; // relative (e.g. ".git") → primary clone
  const primary = path.dirname(commonDir);
  if (path.resolve(primary) === path.resolve(srcRepo)) return;
  throw new Error(
    `Refusing to create a nested worktree.\n` +
      `  '${srcRepo}' is itself a worktree of '${primary}'.\n` +
      `  Create worktrees from the primary clone, or pass a repo name:\n` +
      `    glrs wt new <repo>`,
  );
}

/** Create a worktree with a new branch. Does NOT spawn a shell. */
export function createWorktree(opts: CreateOptions = {}): CreateResult {
  const srcRepo = opts.repoPath ?? gitRoot();
  assertPrimaryClone(srcRepo);
  const repo = opts.repo ?? path.basename(srcRepo);
  const name = opts.name ?? autoName();
  const wtPath = worktreePath(name, repo);

  if (existsSync(wtPath)) {
    throw new Error(`Worktree already exists: ${wtPath}`);
  }
  mkdirSync(path.dirname(wtPath), { recursive: true });

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
  if (existsSync(wtPath)) {
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
