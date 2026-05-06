/**
 * Pilot v2 path resolution.
 *
 * All pilot state lives under:
 *   ~/.glorious/opencode/<repo-folder>/pilot/
 *
 * Layout:
 *   pilot/
 *   ├── state.sqlite          — workflow + event log
 *   ├── current-scope.json    — symlink/pointer to the active scope artifact
 *   └── scopes/
 *       └── <workflow-id>/
 *           ├── scope.json    — framing + acceptance criteria
 *           └── plan.json     — task list produced by the planner
 *
 * Uses the same repo-folder derivation as plan-paths.ts (git rev-parse
 * --git-common-dir → parent dir basename).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function execFileP(
  file: string,
  args: readonly string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { cwd, timeoutMs = 5000 } = opts;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    execFile(
      file,
      args,
      { signal: controller.signal, cwd, encoding: "utf8" },
      (err, stdout) => {
        clearTimeout(timer);
        if (err) { reject(err); return; }
        resolve(stdout ?? "");
      },
    );
  });
}

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the worktree-agnostic repo key from a working directory.
 * Returns the basename of the parent of the shared .git directory.
 */
export async function getRepoFolder(cwd: string): Promise<string> {
  let stdout: string;
  try {
    stdout = await execFileP("git", ["rev-parse", "--git-common-dir"], { cwd });
  } catch (err) {
    throw new Error(
      `pilot paths: could not determine repo folder from ${JSON.stringify(cwd)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const gitCommonDir = stdout.trim();
  // --git-common-dir returns a path relative to cwd (or absolute).
  const abs = path.isAbsolute(gitCommonDir)
    ? gitCommonDir
    : path.resolve(cwd, gitCommonDir);
  return path.basename(path.dirname(abs));
}

/**
 * Resolve the pilot base directory for the repo containing `cwd`.
 * Creates the directory if it doesn't exist.
 *
 * Honors $GLORIOUS_PILOT_DIR override (for tests).
 */
export async function getPilotDir(cwd: string): Promise<string> {
  const override = process.env["GLORIOUS_PILOT_DIR"];
  if (override) {
    const dir = expandTilde(override);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  const repoFolder = await getRepoFolder(cwd);
  const base = path.join(os.homedir(), ".glorious", "opencode", repoFolder, "pilot");
  await fs.mkdir(base, { recursive: true });
  return base;
}

/** Path to the SQLite state database. */
export async function getStateDbPath(cwd: string): Promise<string> {
  const base = await getPilotDir(cwd);
  return path.join(base, "state.sqlite");
}

/** Path to the current-scope pointer file. */
export async function getCurrentScopePath(cwd: string): Promise<string> {
  const base = await getPilotDir(cwd);
  return path.join(base, "current-scope.json");
}

/** Path to the scope artifact for a specific workflow. */
export async function getScopeArtifactPath(cwd: string, workflowId: string): Promise<string> {
  const base = await getPilotDir(cwd);
  const dir = path.join(base, "scopes", workflowId);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "scope.json");
}

/** Path to the plan artifact for a specific workflow. */
export async function getPlanArtifactPath(cwd: string, workflowId: string): Promise<string> {
  const base = await getPilotDir(cwd);
  const dir = path.join(base, "scopes", workflowId);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "plan.json");
}

/** Path to the .glrs/pilot.json config file in the repo. */
export function getPilotConfigPath(cwd: string): string {
  return path.join(cwd, ".glrs", "pilot.json");
}
