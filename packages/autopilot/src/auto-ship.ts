/**
 * Auto-ship module for the autopilot (item 4.7).
 *
 * After all phases pass and a changeset has been generated, --ship
 * pushes the current branch upstream and opens a PR via `gh pr create`.
 *
 * Hard rules (mirrored from AGENTS.md and the SPEAR Resolve stage):
 *   - Never `git push --force` or `git push -f`
 *   - Never push to `main` or `master`
 *   - Never `--no-verify`
 *   - Never merge a PR — only open one
 *
 * The PR title is the plan's H1 (verbatim). The PR body is the literal
 * contents of main.md (or the single-file plan), passed to gh via
 * `--body-file` to dodge shell-escaping bugs.
 *
 * Failure modes (all surface as thrown errors so the caller can log
 * and degrade gracefully):
 *   - Branch is `main`/`master`/detached HEAD → ABORT
 *   - `git push` returns non-zero → ABORT
 *   - `gh` is not installed or not authenticated → ABORT
 *   - PR already exists for the branch → ABORT (call /ship to update)
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { hasSpec, readSpecTitle } from "./spec-parser.js";

const execFileDefault = promisify(execFileCb);

const FORBIDDEN_BRANCHES = new Set(["main", "master"]);

export interface AutoShipOptions {
  /** Plan path (file or directory). The PR title comes from the plan's H1. */
  planPath: string;
  /** Repo root (used as cwd for git/gh invocations). */
  repoRoot: string;
  /**
   * Test-only: inject execFile replacement.
   * @internal
   */
  _deps?: {
    execFile?: typeof execFileDefault;
  };
}

export interface AutoShipResult {
  prUrl: string;
  branch: string;
  /** Title used for the PR. */
  title: string;
}

/**
 * Resolve the path of the plan's main markdown file. For a directory
 * plan, returns `<dir>/main.md`. For a single-file plan, returns the
 * file itself.
 */
function resolvePlanMainPath(planPath: string): string {
  try {
    if (fs.statSync(planPath).isDirectory()) {
      return path.join(planPath, "main.md");
    }
  } catch {
    // fall through
  }
  return planPath;
}

/**
 * Read the plan's H1 and use it as the PR title. Falls back to a
 * default when the plan has no heading.
 */
function readPlanH1(planPath: string): string {
  // YAML spec path: read title from spec/main.yaml when available
  try {
    if (fs.statSync(planPath).isDirectory() && hasSpec(planPath)) {
      const yamlTitle = readSpecTitle(planPath);
      if (yamlTitle) return yamlTitle;
    }
  } catch {
    // fall through
  }
  const target = resolvePlanMainPath(planPath);
  try {
    const content = fs.readFileSync(target, "utf-8");
    const match = content.match(/^#\s+(.+?)\s*$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through
  }
  return "Autopilot run";
}

/**
 * Push the current branch and open a PR. Returns the PR URL on success;
 * throws on any of the abort conditions documented at the module top.
 */
export async function autoShip(opts: AutoShipOptions): Promise<AutoShipResult> {
  const execFile = opts._deps?.execFile ?? execFileDefault;
  const cwd = opts.repoRoot;

  // 1. Resolve the current branch and gate on the forbidden set.
  let branch: string;
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    branch = (typeof stdout === "string" ? stdout : String(stdout)).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`auto-ship: failed to resolve current branch: ${msg}`);
  }

  if (!branch || branch === "HEAD") {
    throw new Error(
      `auto-ship: refusing to ship from a detached HEAD (branch="${branch}")`,
    );
  }
  if (FORBIDDEN_BRANCHES.has(branch)) {
    throw new Error(
      `auto-ship: refusing to push to forbidden branch "${branch}". Create a feature branch first.`,
    );
  }

  // 2. Push (no force, no skip-hooks). Set upstream so the PR command
  // can find the branch.
  try {
    await execFile("git", ["push", "-u", "origin", branch], { cwd });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`auto-ship: git push failed: ${msg}`);
  }

  // 3. Open the PR. Body comes from the plan's main file via --body-file
  // to dodge shell-escape bugs.
  const title = readPlanH1(opts.planPath);
  const bodyFile = resolvePlanMainPath(opts.planPath);
  if (!fs.existsSync(bodyFile)) {
    throw new Error(`auto-ship: plan body file not found: ${bodyFile}`);
  }

  let prUrl: string;
  try {
    const { stdout } = await execFile(
      "gh",
      [
        "pr",
        "create",
        "--title",
        title,
        "--body-file",
        bodyFile,
      ],
      { cwd },
    );
    const text = typeof stdout === "string" ? stdout : String(stdout);
    // gh pr create prints the PR URL on the last line.
    const urlMatch = text.match(/https?:\/\/\S+/);
    prUrl = urlMatch ? urlMatch[0] : text.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`auto-ship: gh pr create failed: ${msg}`);
  }

  return { prUrl, branch, title };
}
