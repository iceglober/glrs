import { execaSync } from "execa";

/** Run a git command and return trimmed stdout. Throws on failure. */
export function git(...args: string[]): string {
  return execaSync("git", args).stdout.trim();
}

/** Run a git command, returning null on failure instead of throwing. */
export function gitSafe(...args: string[]): string | null {
  try {
    const result = execaSync("git", args, { reject: false, stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/** Run a git command inside a specific directory. */
export function gitIn(cwd: string, ...args: string[]): string {
  return execaSync("git", args, { cwd }).stdout.trim();
}

export function gitInSafe(cwd: string, ...args: string[]): string | null {
  try {
    const result = execaSync("git", args, { cwd, reject: false, stderr: "pipe" });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/** Spawn an interactive shell in a directory. Returns when the shell exits. */
export function spawnShell(cwd: string): void {
  const shell = process.env.SHELL || "bash";
  execaSync(shell, { cwd, stdio: "inherit" });
}

/** Get the root of the main worktree (resolves through linked worktrees). */
export function gitRoot(): string {
  const commonDir = git("rev-parse", "--git-common-dir");
  if (commonDir === ".git" || commonDir.endsWith("/.git")) {
    return git("rev-parse", "--show-toplevel");
  }
  // We're in a linked worktree -- resolve main from commondir
  const path = require("node:path");
  return path.dirname(commonDir);
}

/** Detect the default branch (main/master). */
export function defaultBranch(): string {
  // Try symbolic ref first
  const ref = gitSafe(
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  );
  if (ref) {
    return ref.replace("refs/remotes/origin/", "");
  }

  // Fall back to checking common names on remote
  for (const name of ["main", "master"]) {
    if (
      gitSafe("show-ref", "--verify", `refs/remotes/origin/${name}`) !== null
    ) {
      return name;
    }
  }

  // No remote -- check local branches
  for (const name of ["main", "master"]) {
    if (
      gitSafe("show-ref", "--verify", `refs/heads/${name}`) !== null
    ) {
      return name;
    }
  }

  throw new Error(
    "Cannot detect default branch. Set it with: git remote set-head origin <branch>",
  );
}

export interface WorktreeEntry {
  path: string;
  commit: string;
  branch: string | null; // null = detached
}

/** Parse `git worktree list --porcelain` output into structured entries. */
export function listWorktrees(): WorktreeEntry[] {
  const raw = git("worktree", "list", "--porcelain");
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of raw.split("\n")) {
    if (line === "") {
      if (current.path) {
        entries.push({
          path: current.path,
          commit: current.commit ?? "",
          branch: current.branch ?? null,
        });
      }
      current = {};
      continue;
    }

    if (line.startsWith("worktree ")) current.path = line.slice(9);
    else if (line.startsWith("HEAD ")) current.commit = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7);
  }

  // Handle last entry (porcelain output may not end with blank line)
  if (current.path) {
    entries.push({
      path: current.path,
      commit: current.commit ?? "",
      branch: current.branch ?? null,
    });
  }

  return entries;
}
