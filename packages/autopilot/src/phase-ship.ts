/**
 * Per-phase PR creation for stacked-PR workflows.
 *
 * Smart-optional: only activates when a phase has a `branch` field in
 * its spec. When absent, the entire module is never imported.
 *
 * Safety invariants (same as auto-ship.ts):
 *   - Never `git push --force`
 *   - Never push to `main` or `master`
 *   - Never `--no-verify`
 *   - Never merge a PR — only open one
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCb);

const FORBIDDEN_BRANCHES = new Set(["main", "master"]);

export interface PhaseShipOptions {
  branch: string;
  base?: string;
  title: string;
  repoRoot: string;
  /** @internal */
  _deps?: { execFile?: typeof execFileDefault };
}

export interface PhaseShipResult {
  prUrl: string;
  branch: string;
}

/**
 * Create or checkout the phase branch, push it, and open a PR.
 * Never throws — returns null on any failure so the autopilot
 * can continue even if PR creation fails.
 */
export async function shipPhase(opts: PhaseShipOptions): Promise<PhaseShipResult | null> {
  const exec = opts._deps?.execFile ?? execFileDefault;
  const cwd = opts.repoRoot;

  if (FORBIDDEN_BRANCHES.has(opts.branch)) return null;

  try {
    await exec("git", ["push", "-u", "origin", opts.branch], { cwd });

    const baseArgs = opts.base ? ["--base", opts.base] : [];
    const { stdout } = await exec(
      "gh",
      ["pr", "create", "--title", opts.title, ...baseArgs, "--body", `Phase branch: \`${opts.branch}\``],
      { cwd },
    );

    const prUrl = stdout.trim().split("\n").pop() ?? "";
    return { prUrl, branch: opts.branch };
  } catch {
    return null;
  }
}
