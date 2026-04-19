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
  const path = require("node:path");
  // In the primary clone, git returns a relative path (e.g. ".git").
  // In a linked worktree, it returns the absolute path to the primary
  // clone's .git directory — its parent is the primary clone root.
  if (!path.isAbsolute(commonDir)) {
    return git("rev-parse", "--show-toplevel");
  }
  return path.dirname(commonDir);
}

/** Detect the default branch (main/master) for the current repo. */
export function defaultBranch(): string {
  return defaultBranchIn(process.cwd());
}

/** Detect the default branch (main/master) for a specific repo path. */
export function defaultBranchIn(repoPath: string): string {
  const ref = gitInSafe(repoPath, "symbolic-ref", "refs/remotes/origin/HEAD");
  if (ref) return ref.replace("refs/remotes/origin/", "");

  for (const name of ["main", "master"]) {
    if (
      gitInSafe(
        repoPath,
        "show-ref",
        "--verify",
        `refs/remotes/origin/${name}`,
      ) !== null
    ) {
      return name;
    }
  }
  for (const name of ["main", "master"]) {
    if (
      gitInSafe(repoPath, "show-ref", "--verify", `refs/heads/${name}`) !== null
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
