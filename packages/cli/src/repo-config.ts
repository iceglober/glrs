/**
 * Repo + worktree configuration for the autopilot TUI.
 *
 * Reads configured repo roots from `~/.config/glrs/repos.yaml` and
 * scans `~/.glrs/worktrees/` (primary) and `~/.glorious/worktrees/` (legacy
 * fallback) for managed worktrees. Merges all sources and annotates each
 * with whether an autopilot session is active.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoInfo {
  /** Absolute path to the repo/worktree root. */
  path: string;
  /** Human-readable name (directory basename or configured name). */
  name: string;
  /** Current git branch, if detectable. */
  branch?: string;
  /** True if `.agent/autopilot-events.jsonl` exists in this directory. */
  hasActiveAutopilot: boolean;
}

/**
 * A unique repo identity — not a worktree, but the repo group itself.
 * Used by the new-session flow to pick a repo before creating a worktree.
 */
export interface UniqueRepo {
  /** Repo group name (e.g. "glrs", "my-project"). */
  name: string;
  /** Absolute path to the primary clone / repo root. */
  primaryPath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPOS_CONFIG_PATH = path.join(os.homedir(), ".config", "glrs", "repos.yaml");
// Primary (new writes)
const WORKTREES_BASE_DIR = path.join(os.homedir(), ".glrs", "worktrees");
const OPENCODE_BASE_DIR = path.join(os.homedir(), ".glrs", "opencode");
// Legacy fallbacks (reads only)
const LEGACY_WORKTREES_BASE_DIR = path.join(os.homedir(), ".glorious", "worktrees");
const LEGACY_OPENCODE_BASE_DIR = path.join(os.homedir(), ".glorious", "opencode");
const EVENT_FILE_RELATIVE = path.join(".agent", "autopilot-events.jsonl");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the current git branch from a repo directory. Returns undefined on failure. */
function readGitBranch(repoPath: string): string | undefined {
  const headFile = path.join(repoPath, ".git", "HEAD");
  try {
    const content = fs.readFileSync(headFile, "utf8").trim();
    // "ref: refs/heads/<branch>"
    const match = content.match(/^ref: refs\/heads\/(.+)$/);
    return match ? match[1] : undefined;
  } catch {
    // Worktrees have a .git file (not directory) pointing to the main repo.
    // Try reading it as a file.
    try {
      const gitFile = path.join(repoPath, ".git");
      const content = fs.readFileSync(gitFile, "utf8").trim();
      // "gitdir: /path/to/.git/worktrees/<name>"
      const gitdirMatch = content.match(/^gitdir:\s*(.+)$/);
      if (gitdirMatch) {
        const worktreeGitDir = gitdirMatch[1];
        const headPath = path.join(worktreeGitDir, "HEAD");
        const headContent = fs.readFileSync(headPath, "utf8").trim();
        const branchMatch = headContent.match(/^ref: refs\/heads\/(.+)$/);
        return branchMatch ? branchMatch[1] : undefined;
      }
    } catch {
      // Give up
    }
    return undefined;
  }
}

/** Check if an autopilot event file exists in a directory. */
function hasActiveAutopilot(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, EVENT_FILE_RELATIVE));
}

/** Build a RepoInfo from a directory path and optional name override. */
function buildRepoInfo(repoPath: string, nameOverride?: string): RepoInfo {
  const name = nameOverride ?? path.basename(repoPath);
  return {
    path: repoPath,
    name,
    branch: readGitBranch(repoPath),
    hasActiveAutopilot: hasActiveAutopilot(repoPath),
  };
}

// ---------------------------------------------------------------------------
// Config file schema
// ---------------------------------------------------------------------------

interface ReposYaml {
  repos?: Array<string | { path: string; name?: string }>;
}

function parseReposYaml(raw: string): ReposYaml {
  try {
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ReposYaml;
    }
    return {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Core implementation (injectable for testing)
// ---------------------------------------------------------------------------

interface RepoConfigPaths {
  reposConfigPath: string;
  worktreesBaseDir: string;
  /** Optional legacy worktrees dir to scan as fallback (read-only). */
  legacyWorktreesBaseDir?: string;
}

/**
 * Factory that returns a `getConfiguredRepos`-like function using custom paths.
 * Useful for testing without touching the real home directory.
 */
export function createRepoConfigReader(
  paths: RepoConfigPaths,
): () => RepoInfo[] {
  return () => readRepos(paths);
}

function readRepos({ reposConfigPath, worktreesBaseDir, legacyWorktreesBaseDir }: RepoConfigPaths): RepoInfo[] {
  const seen = new Set<string>();
  const results: RepoInfo[] = [];

  function addRepo(repoPath: string, nameOverride?: string): void {
    const resolved = path.resolve(repoPath);
    if (seen.has(resolved)) return;
    if (!fs.existsSync(resolved)) return;

    seen.add(resolved);
    results.push(buildRepoInfo(resolved, nameOverride));
  }

  // Source 1: repos.yaml
  try {
    const raw = fs.readFileSync(reposConfigPath, "utf8");
    const config = parseReposYaml(raw);

    if (Array.isArray(config.repos)) {
      for (const entry of config.repos) {
        if (typeof entry === "string") {
          addRepo(entry);
        } else if (entry && typeof entry === "object" && typeof entry.path === "string") {
          addRepo(entry.path, entry.name);
        }
      }
    }
  } catch {
    // File doesn't exist or is unreadable — skip
  }

  // Source 2: worktrees directories (primary first, then legacy fallback)
  const worktreesDirs = [worktreesBaseDir];
  if (legacyWorktreesBaseDir) worktreesDirs.push(legacyWorktreesBaseDir);

  for (const baseDir of worktreesDirs) {
    try {
      if (!fs.existsSync(baseDir)) continue;

      const repoGroups = fs.readdirSync(baseDir, { withFileTypes: true });

      for (const repoGroup of repoGroups) {
        if (!repoGroup.isDirectory()) continue;

        const repoGroupPath = path.join(baseDir, repoGroup.name);

        let worktreeEntries: fs.Dirent[];
        try {
          worktreeEntries = fs.readdirSync(repoGroupPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const wt of worktreeEntries) {
          if (!wt.isDirectory()) continue;
          const wtPath = path.join(repoGroupPath, wt.name);
          addRepo(wtPath, `${repoGroup.name}/${wt.name}`);
        }
      }
    } catch {
      // Worktrees dir unreadable — skip
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// getConfiguredRepos
// ---------------------------------------------------------------------------

/**
 * Returns all known repos/worktrees, merged from two sources:
 *
 * 1. `~/.config/glrs/repos.yaml` — explicitly configured repo roots.
 *    Format: `repos: ["/path/to/repo", { path: "/other", name: "alias" }]`
 *
 * 2. `~/.glrs/worktrees/` — managed worktrees created by `glrs` (primary).
 *    `~/.glorious/worktrees/` is also scanned as a legacy fallback.
 *    Each subdirectory is a repo group; each subdirectory within is a worktree.
 *
 * Deduplicates by resolved path. Skips paths that don't exist.
 */
export function getConfiguredRepos(): RepoInfo[] {
  return readRepos({
    reposConfigPath: REPOS_CONFIG_PATH,
    worktreesBaseDir: WORKTREES_BASE_DIR,
    legacyWorktreesBaseDir: LEGACY_WORKTREES_BASE_DIR,
  });
}

// ---------------------------------------------------------------------------
// getUniqueRepos — for the new-session flow
// ---------------------------------------------------------------------------

/**
 * Returns unique repo identities (not individual worktrees).
 *
 * Sources:
 * 1. repos.yaml entries (each is a unique repo)
 * 2. Top-level directories under ~/.glrs/worktrees/ and ~/.glorious/worktrees/ (each is a repo group)
 *
 * For worktree groups, picks the first worktree's path as `primaryPath`
 * (the actual primary clone path isn't stored — the worktree is good enough
 * for plan discovery).
 */
export function getUniqueRepos(): UniqueRepo[] {
  return readUniqueRepos({
    reposConfigPath: REPOS_CONFIG_PATH,
    worktreesBaseDir: WORKTREES_BASE_DIR,
    legacyWorktreesBaseDir: LEGACY_WORKTREES_BASE_DIR,
  });
}

function readUniqueRepos({ reposConfigPath, worktreesBaseDir, legacyWorktreesBaseDir }: RepoConfigPaths): UniqueRepo[] {
  /** Dedup by resolved primaryPath — two entries pointing at the same clone are one repo. */
  const byPath = new Map<string, UniqueRepo>();

  function addOrUpgrade(name: string, primaryPath: string): void {
    const resolved = path.resolve(primaryPath);
    const existing = byPath.get(resolved);
    if (existing) {
      // Prefer a "real" repo name over a worktree slug (wt-YYMMDD-*).
      // If the existing entry has a slug name and the new one doesn't, upgrade.
      const existingIsSlug = /^wt-\d{6}-/.test(existing.name);
      const newIsSlug = /^wt-\d{6}-/.test(name);
      if (existingIsSlug && !newIsSlug) {
        byPath.set(resolved, { name, primaryPath: resolved });
      }
      return;
    }
    byPath.set(resolved, { name, primaryPath: resolved });
  }

  // Source 1: repos.yaml
  try {
    const raw = fs.readFileSync(reposConfigPath, "utf8");
    const config = parseReposYaml(raw);

    if (Array.isArray(config.repos)) {
      for (const entry of config.repos) {
        const repoPath = typeof entry === "string" ? entry : entry?.path;
        const name = typeof entry === "object" && entry?.name ? entry.name : undefined;
        if (!repoPath) continue;
        const resolved = path.resolve(repoPath);
        if (!fs.existsSync(resolved)) continue;
        addOrUpgrade(name ?? path.basename(resolved), resolved);
      }
    }
  } catch {
    // File doesn't exist or is unreadable — skip
  }

  // Source 2: worktree group directories (primary first, then legacy fallback)
  const worktreesDirs = [worktreesBaseDir];
  if (legacyWorktreesBaseDir) worktreesDirs.push(legacyWorktreesBaseDir);

  for (const baseDir of worktreesDirs) {
    try {
      if (!fs.existsSync(baseDir)) continue;

      const repoGroups = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const repoGroup of repoGroups) {
        if (!repoGroup.isDirectory()) continue;

        const groupPath = path.join(baseDir, repoGroup.name);

        // Resolve the actual primary clone by reading the first worktree's
        // .git file (gitdir: points back to the primary clone's .git/worktrees/).
        let primaryPath = groupPath;
        try {
          const entries = fs.readdirSync(groupPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const wtPath = path.join(groupPath, entry.name);
            const gitFile = path.join(wtPath, ".git");
            try {
              const content = fs.readFileSync(gitFile, "utf8").trim();
              const match = content.match(/^gitdir:\s*(.+)$/);
              if (match) {
                const gitWorktreeDir = match[1];
                const dotGitDir = path.resolve(path.dirname(path.dirname(gitWorktreeDir)));
                const cloneRoot = path.dirname(dotGitDir);
                if (fs.existsSync(cloneRoot)) {
                  primaryPath = cloneRoot;
                  break;
                }
              }
            } catch {
              // Not a worktree .git file — try next
            }
          }
        } catch {
          // Can't read group dir — use groupPath as fallback
        }

        addOrUpgrade(repoGroup.name, primaryPath);
      }
    } catch {
      // Worktrees dir unreadable — skip
    }
  }

  // Source 3: opencode directories (primary ~/.glrs/opencode first, then legacy ~/.glorious/opencode)
  // These represent repos that have been used with the autopilot (have plans, etc.)
  // but may not have worktrees under the worktrees dirs.
  const opencodeDirs = [OPENCODE_BASE_DIR, LEGACY_OPENCODE_BASE_DIR];
  for (const opencodeDir of opencodeDirs) {
    try {
      if (fs.existsSync(opencodeDir)) {
        const entries = fs.readdirSync(opencodeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          // Skip known non-repo directories
          if (entry.name.startsWith("tmp") || entry.name.startsWith("costs")) continue;
          if (entry.name === "default-base" || entry.name === "default-pilot" || entry.name === "pilot-smoke") continue;

          const repoName = entry.name;
          // Already found via worktrees? Skip — we already have the primary path.
          const alreadyFound = Array.from(byPath.values()).some(r => r.name === repoName);
          if (alreadyFound) continue;

          // We know the repo name but not the clone path. The opencode dir itself
          // is useful for plan discovery (plans live there), so use it as primaryPath.
          // The plan scanner will find plans in <opencodeDir>/<name>/plans/.
          addOrUpgrade(repoName, path.join(opencodeDir, repoName));
        }
      }
    } catch {
      // Opencode dir unreadable — skip
    }
  }

  // Sort alphabetically by name for stable display order
  return Array.from(byPath.values()).sort((a, b) => a.name.localeCompare(b.name));
}
