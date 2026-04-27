import { command, positional, option, optional, string } from "cmd-ts";
import { spawnShell } from "../lib/git.js";
import { info } from "../lib/fmt.js";
import { createWorktree } from "../lib/worktree.js";
import { loadRegistry } from "../lib/registry.js";
import type { RepoIndex } from "./types.js";
import * as path from "node:path";
import * as os from "node:os";

const INDEX_DIR = path.join(os.homedir(), ".glorious");
const INDEX_FILE = path.join(INDEX_DIR, "repos.json");

function existsSync(filePath: string): boolean {
  // @ts-ignore - Bun types
  return Bun.file(filePath).existsSync();
}

function readTextSync(filePath: string): string | null {
  try {
    // @ts-ignore - Bun types
    return Bun.file(filePath).textSync();
  } catch {
    return null;
  }
}

function loadRepoIndex(): RepoIndex {
  if (!existsSync(INDEX_FILE)) return {};
  try {
    const raw = readTextSync(INDEX_FILE);
    if (!raw) return {};
    return JSON.parse(raw) as RepoIndex;
  } catch {
    return {};
  }
}

function lookupRepo(name: string): string | null {
  return loadRepoIndex()[name] ?? null;
}

function scanRoots(): string[] {
  return ["~/repos", "~/code", "~/src"]
    .map((p) => p.replace("~", os.homedir()))
    .filter((p) => existsSync(p));
}

function findRepoByScan(name: string, maxDepth = 4): string | null {
  const skip = new Set(["node_modules", "target", "dist", "vendor"]);

  for (const root of scanRoots()) {
    const hit = walk(root, name, skip, maxDepth, 0);
    if (hit) return hit;
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
  if (path.basename(dir) === name && existsSync(path.join(dir, ".git"))) {
    return dir;
  }

  let children: string[];
  try {
    children = require("fs").readdirSync(dir);
  } catch {
    return null;
  }

  if (existsSync(path.join(dir, ".git"))) return null;

  for (const child of children) {
    if (skip.has(child) || child.startsWith(".")) continue;
    const full = path.join(dir, child);
    let stat: import("fs").Stats;
    try {
      stat = require("fs").statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const found = walk(full, name, skip, maxDepth, depth + 1);
    if (found) return found;
  }
  return null;
}

function resolveRepoPath(repo: string | undefined): string | undefined {
  if (!repo) return undefined;

  const wt = loadRegistry().find((e) => e.repo === repo);
  if (wt) {
    if (!existsSync(wt.repoPath)) {
      throw new Error(
        `Registered repo '${repo}' points to ${wt.repoPath}, which no longer exists.`,
      );
    }
    return wt.repoPath;
  }

  const indexed = lookupRepo(repo);
  if (indexed) return indexed;

  const scanned = findRepoByScan(repo);
  if (scanned) return scanned;

  throw new Error(
    `No repo named '${repo}' found.\n` +
      `  Looked in worktree registry, ~/.glorious/repos.json, and scan roots.\n` +
      `  Fix: run 'glrs wt new' from inside the repo once.`,
  );
}

export const create = command({
  name: "new",
  aliases: ["create"],
  description:
    "Create a worktree from the latest origin default branch. Name is auto-generated.",
  args: {
    repo: positional({
      type: optional(string),
      displayName: "repo",
      description:
        "Optional repo name. Required when running outside a git repo; looked up in the worktree registry, the repo index, or under repo.scan-roots.",
    }),
    from: option({
      type: optional(string),
      long: "from",
      description:
        "Base branch override (default: remote default branch). Rare — prefer default.",
    }),
  },
  handler: ({ repo, from }) => {
    const repoPath = resolveRepoPath(repo);
    const { wtPath } = createWorktree({ from, repoPath, repo });
    console.log(`\n  cd ${wtPath}\n`);

    if (process.stdin.isTTY) {
      info("spawning shell in worktree (exit to return)...");
      spawnShell(wtPath);
    }
  },
});
