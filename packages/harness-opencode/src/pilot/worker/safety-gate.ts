/**
 * Safety gate for cwd-mode pilot runs.
 *
 * Runs once at the top of `runWorker` (before any task is picked) and
 * once at the top of `build-resume`. Refuses to proceed unless:
 *
 *   1. cwd is inside a git worktree (not a bare clone, not a loose dir).
 *   2. cwd is NOT on main / master / the remote's default branch.
 *   3. Working tree is clean: no uncommitted tracked changes, no non-
 *      gitignored untracked files. Exceptions:
 *      - `.gitignored` files (excluded by `git status --porcelain` already).
 *      - Paths matching `SAFETY_GATE_TOLERATE` (framework noise the user
 *        didn't author — opencode plugin installer churn, Next.js build
 *        artifacts, tsbuildinfo, snapshot files).
 *
 * On a failed gate, `runWorker` returns `{ aborted: true, attempted: [] }`.
 * We never auto-stash, auto-commit, or switch branches on the user's behalf.
 *
 * A successful gate can still carry `warnings` — messages the caller
 * should surface to the user. E.g., "note: .opencode/package-lock.json
 * was modified by framework; treating tree as clean for pilot start."
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import picomatch from "picomatch";

const execFileP = promisify(execFile);

/**
 * Paths where "dirty" is framework noise, not user intent. Same spirit
 * as `DEFAULT_TOLERATE` in `verify/touches.ts` — files that tools outside
 * pilot's control routinely rewrite without the user's say-so. Dirt
 * that's EXCLUSIVELY in these paths is allowed; pilot proceeds with a
 * warning. Dirt outside them still refuses.
 */
export const SAFETY_GATE_TOLERATE: readonly string[] = [
  // opencode plugin installer churn. opencode upgrades its own plugin
  // dependency in the background, which bumps the pinned version in
  // .opencode/package.json + .opencode/package-lock.json. Users don't
  // author those edits; refusing to start pilot because of them is a
  // consistent friction.
  ".opencode/**",
  // Next.js — `next build` regenerates this every run, often outside
  // a pilot session.
  "**/next-env.d.ts",
  // Next.js app-router generated types.
  "**/.next/types/**",
  "**/.next/dev/types/**",
  // TypeScript project-reference build info — tsc writes these.
  "**/*.tsbuildinfo",
  // Snapshot test files rewritten by `vitest -u` / `jest -u`.
  "**/__snapshots__/**",
  "**/*.snap",
];

async function git(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  for (const a of args) {
    if (a.includes("\0")) {
      throw new Error(`git arg contains null byte: ${JSON.stringify(a)}`);
    }
  }
  try {
    const { stdout, stderr } = await execFileP("git", args as string[], {
      cwd,
      timeout: 10_000,
      maxBuffer: 1 << 20,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), ok: true };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
      ok: false,
    };
  }
}

export async function headSha(cwd: string): Promise<string> {
  const r = await git(cwd, ["rev-parse", "HEAD"]);
  if (!r.ok) throw new Error(`git rev-parse HEAD failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export type SafetyGateResult =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

const FORBIDDEN_BRANCHES = new Set(["main", "master"]);

/**
 * Parse `git status --porcelain` output into file paths.
 *
 * Porcelain v1 format: `XY <path>` where `X` is the staged status,
 * `Y` is the working-tree status, followed by a space and the path.
 * Renames use `XY <old> -> <new>` — we take the new path. Null bytes
 * can appear in `-z` mode but we don't use `-z`, so line-split is safe.
 */
function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    // Strip "XY " prefix (3 chars).
    let rest = line.slice(3);
    // Rename syntax: "<old> -> <new>". Take the new path.
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    // Paths with spaces may be quoted; strip surrounding quotes if so.
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1);
    }
    paths.push(rest);
  }
  return paths;
}

export async function checkCwdSafety(cwd: string): Promise<SafetyGateResult> {
  // (1) must be inside a git worktree
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      ok: false,
      reason: `not inside a git worktree: ${cwd}`,
    };
  }

  // (2) must not be on main/master/default branch
  const branchRes = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchRes.ok) {
    return {
      ok: false,
      reason: `cannot determine current branch: ${branchRes.stderr.trim()}`,
    };
  }
  const branch = branchRes.stdout.trim();
  if (FORBIDDEN_BRANCHES.has(branch)) {
    return {
      ok: false,
      reason: `refuse to run on protected branch: ${branch}. Switch to a feature branch first.`,
    };
  }
  const defaultRes = await git(cwd, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (defaultRes.ok) {
    const remoteDefault = defaultRes.stdout.trim().replace(/^origin\//, "");
    if (remoteDefault && branch === remoteDefault) {
      return {
        ok: false,
        reason: `refuse to run on the remote's default branch: ${branch}. Switch to a feature branch first.`,
      };
    }
  }

  // (3) working tree must be clean (or only dirty in tolerated paths)
  const statusRes = await git(cwd, ["status", "--porcelain"]);
  if (!statusRes.ok) {
    return {
      ok: false,
      reason: `git status failed: ${statusRes.stderr.trim()}`,
    };
  }
  // DO NOT trim the whole stdout — porcelain v1 lines start with a
  // status code that may include leading spaces (e.g., ` M path` means
  // unstaged modification). Trimming the outer string drops that leading
  // space from the first line and throws off the fixed-offset parser.
  // Check emptiness by stripping a trailing newline only.
  const rawStdout = statusRes.stdout.replace(/\n$/, "");
  if (rawStdout.length === 0) {
    return { ok: true, warnings: [] };
  }

  // Partition: tolerated (framework noise) vs. genuine (user work).
  const paths = parsePorcelainPaths(rawStdout);
  const matchTolerate = picomatch([...SAFETY_GATE_TOLERATE], { dot: true });
  const tolerated: string[] = [];
  const genuine: string[] = [];
  for (const p of paths) {
    if (matchTolerate(p)) tolerated.push(p);
    else genuine.push(p);
  }

  if (genuine.length > 0) {
    // Print the full porcelain output (first 10 lines) so the user sees
    // both tolerated and genuine in context. The rejection is because
    // of `genuine`, but `tolerated` appearing is also worth seeing.
    const lines = rawStdout
      .split("\n")
      .slice(0, 10)
      .map((s) => "  " + s)
      .join("\n");
    return {
      ok: false,
      reason:
        `working tree is dirty; pilot refuses to run on uncommitted changes.\n` +
        `Commit, stash, or discard them, then re-run.\n` +
        `First 10 lines of git status --porcelain:\n${lines}`,
    };
  }

  // All dirt is in tolerated paths. Proceed with a warning so the user
  // sees what's being ignored — if they had intentional work in one of
  // these paths they'll notice and can ctrl-c.
  const preview = tolerated.slice(0, 5);
  const suffix =
    tolerated.length > preview.length
      ? ` (+${tolerated.length - preview.length} more)`
      : "";
  const warnings = [
    `working tree has ${tolerated.length} modified file(s) in framework-owned paths; ` +
      `treating tree as clean:\n` +
      preview.map((p) => `  ${p}`).join("\n") +
      suffix,
  ];
  return { ok: true, warnings };
}
