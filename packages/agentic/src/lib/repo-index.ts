import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getSetting } from "./settings.js";

export type RepoIndex = Record<string, string>;

const INDEX_DIR = path.join(os.homedir(), ".glorious");
const INDEX_FILE = path.join(INDEX_DIR, "repos.json");

/** Load the repo-name → absolute-repo-path index. */
export function loadRepoIndex(): RepoIndex {
  if (!fs.existsSync(INDEX_FILE)) return {};
  try {
    const raw = fs.readFileSync(INDEX_FILE, "utf-8");
    const parsed = JSON.parse(raw) as RepoIndex;
    const pruned: RepoIndex = {};
    for (const [name, p] of Object.entries(parsed)) {
      if (fs.existsSync(p)) pruned[name] = p;
    }
    if (Object.keys(pruned).length !== Object.keys(parsed).length) {
      saveRepoIndex(pruned);
    }
    return pruned;
  } catch {
    return {};
  }
}

function saveRepoIndex(index: RepoIndex): void {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + "\n");
}

/** Idempotently record a repo at a path. */
export function rememberRepo(name: string, repoPath: string): void {
  const abs = path.resolve(repoPath);
  const index = loadRepoIndex();
  if (index[name] === abs) return;
  index[name] = abs;
  saveRepoIndex(index);
}

export function lookupRepo(name: string): string | null {
  return loadRepoIndex()[name] ?? null;
}

/** Configured roots to scan for repos. Defaults to ~/repos, ~/code, ~/src. */
export function scanRoots(): string[] {
  const raw = getSetting("repo.scan-roots");
  const parts = (raw ?? "").split(":").map((p) => p.trim()).filter(Boolean);
  return parts.map(expandHome).filter((p) => fs.existsSync(p));
}

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(1).replace(/^\//, ""));
  }
  return path.resolve(p);
}

/**
 * Walk configured roots looking for a git repo whose basename matches `name`.
 * Depth-limited, does not descend into `.git`, node_modules, target, dist,
 * vendor, .cache. First match wins; remembers it in the index on hit.
 */
export function findRepoByScan(name: string, maxDepth = 4): string | null {
  // All hidden dirs are dropped by the `child.startsWith(".")` check below —
  // only non-hidden noise paths need to go in this set.
  const skip = new Set(["node_modules", "target", "dist", "vendor"]);

  for (const root of scanRoots()) {
    const hit = walk(root, name, skip, maxDepth, 0);
    if (hit) {
      rememberRepo(name, hit);
      return hit;
    }
  }
  return null;
}

function walk(
  dir: string,
  name: string,
  skip: Set<string>,
  maxDepth: number,
  depth: number,
): string | null {
  if (depth > maxDepth) return null;
  if (path.basename(dir) === name && fs.existsSync(path.join(dir, ".git"))) {
    return dir;
  }

  let children: string[];
  try {
    children = fs.readdirSync(dir);
  } catch {
    return null;
  }

  // If this directory is itself a git repo but basename doesn't match, don't
  // descend — we've already checked the basename above.
  if (fs.existsSync(path.join(dir, ".git"))) return null;

  for (const child of children) {
    if (skip.has(child) || child.startsWith(".")) continue;
    const full = path.join(dir, child);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const found = walk(full, name, skip, maxDepth, depth + 1);
    if (found) return found;
  }
  return null;
}
