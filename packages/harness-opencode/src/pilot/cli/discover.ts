/**
 * Run-discovery helpers shared across CLI subcommands that need to
 * locate a state DB on disk.
 *
 * `<pilot>/runs/<runId>/state.db` is the canonical location. Discovery
 * is:
 *
 *   - If `--run <id>` is given: open `<pilot>/runs/<id>/state.db`.
 *   - Otherwise: list `<pilot>/runs/`, find the entry whose
 *     `state.db` has the newest mtime, return that.
 *
 * Returns the run ID, the absolute db path, and the run dir. Callers
 * open the DB themselves so they can choose `:memory:`-style options
 * if needed.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { getPilotDir, getStateDbPath, getRunDir, resolveBaseDir } from "../paths.js";

export type DiscoveredRun = {
  runId: string;
  dbPath: string;
  runDir: string;
};

/**
 * Discover the run to operate on.
 *
 *   - `runId` provided → try `getStateDbPath(cwd, runId)` first (fast
 *                        path). On miss, fall back to scanning every
 *                        repo-folder under `<base>` for a matching
 *                        `<repo>/pilot/runs/<runId>/state.db` — this
 *                        makes `pilot status --run <id>` work from any
 *                        worktree of the same repo (or even a
 *                        different repo, since ULIDs are globally
 *                        unique).
 *   - `runId` absent   → newest run in `<pilot>/runs/` by mtime of
 *                        `state.db` (cwd-scoped only; use `--run <id>`
 *                        for cross-repo).
 *
 * Throws with a descriptive message listing every path tried.
 */
export async function discoverRun(args: {
  cwd: string;
  runId?: string | undefined;
}): Promise<DiscoveredRun> {
  const cwd = args.cwd;
  if (args.runId !== undefined && args.runId.length > 0) {
    const tried: string[] = [];

    // Fast path: cwd-scoped resolution.
    const cwdDbPath = await getStateDbPath(cwd, args.runId);
    tried.push(cwdDbPath);
    try {
      await fs.stat(cwdDbPath);
      const runDir = await getRunDir(cwd, args.runId);
      return { runId: args.runId, dbPath: cwdDbPath, runDir };
    } catch {
      // Fall through to cross-repo scan.
    }

    // Cross-repo scan: look for `<base>/<repoFolder>/pilot/runs/<runId>/state.db`.
    // ULIDs are globally unique so the first hit is unambiguous.
    const base = resolveBaseDir();
    let repoFolders: string[];
    try {
      repoFolders = await fs.readdir(base);
    } catch {
      // <base> doesn't exist → cross-repo scan has nothing to check.
      throw new Error(
        `pilot: no state.db for run ${JSON.stringify(args.runId)} (looked at ${tried.join(", ")}; base ${base} does not exist)`,
      );
    }

    for (const folder of repoFolders) {
      const candidateDbPath = path.join(
        base,
        folder,
        "pilot",
        "runs",
        args.runId,
        "state.db",
      );
      // Skip if we already tried this exact path (e.g. when cwd
      // happens to resolve to one of the scanned folders).
      if (tried.includes(candidateDbPath)) continue;
      // Only follow directories. Tolerates non-repo entries under <base>
      // (backup files, other state dirs, etc.).
      try {
        const stat = await fs.stat(path.join(base, folder));
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      tried.push(candidateDbPath);
      try {
        await fs.stat(candidateDbPath);
        const candidateRunDir = path.join(
          base,
          folder,
          "pilot",
          "runs",
          args.runId,
        );
        return {
          runId: args.runId,
          dbPath: candidateDbPath,
          runDir: candidateRunDir,
        };
      } catch {
        // Not this folder; continue scanning.
      }
    }

    throw new Error(
      `pilot: no state.db for run ${JSON.stringify(args.runId)} (looked at ${tried.join(", ")})`,
    );
  }

  // No id → scan runs dir (cwd-scoped only — `--run <id>` is the
  // escape hatch for cross-repo lookups).
  const pilot = await getPilotDir(cwd);
  const runsDir = path.join(pilot, "runs");
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    throw new Error(
      `pilot: no runs found at ${runsDir} (run \`pilot build\` first)`,
    );
  }
  let newest: { id: string; mtime: number; dbPath: string } | null = null;
  for (const id of entries) {
    const dbPath = path.join(runsDir, id, "state.db");
    let st;
    try {
      st = await fs.stat(dbPath);
    } catch {
      continue;
    }
    if (newest === null || st.mtimeMs > newest.mtime) {
      newest = { id, mtime: st.mtimeMs, dbPath };
    }
  }
  if (newest === null) {
    throw new Error(
      `pilot: no runs with a state.db found in ${runsDir} (was \`pilot build\` interrupted before saving state?)`,
    );
  }
  return {
    runId: newest.id,
    dbPath: newest.dbPath,
    runDir: path.join(runsDir, newest.id),
  };
}
