/**
 * Dependency installation for autopilot worktrees.
 *
 * Detects whether the project uses a JS/TS package manager by looking
 * for lockfiles, then installs dependencies if node_modules is missing.
 * No-op for non-JS projects or when dependencies are already installed.
 *
 * Never throws — all failures return { installed: false } so the
 * autopilot can attempt execution anyway.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";

const execFileDefault = promisify(execFileCb);

const LOCKFILE_TO_COMMAND: Array<[lockfile: string, command: string]> = [
  ["bun.lockb", "bun install"],
  ["bun.lock", "bun install"],
  ["pnpm-lock.yaml", "pnpm install"],
  ["yarn.lock", "yarn install"],
  ["package-lock.json", "npm install"],
];

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

export interface EnsureDepsResult {
  installed: boolean;
  command?: string;
  skipped?: "no-lockfile" | "node-modules-exists";
}

export interface EnsureDepsDeps {
  execFile?: typeof execFileDefault;
  existsSync?: typeof fs.existsSync;
}

/**
 * Ensure JS/TS dependencies are installed. Smart-optional:
 * - No lockfile in cwd → no-op (not a JS project)
 * - node_modules exists → no-op (already installed)
 * - Lockfile found, no node_modules → run install command
 *
 * @param cwd - Working directory (repo root)
 * @param opts.installCommand - Override auto-detected install command
 * @param opts._deps - Injectable deps for testing
 */
export async function ensureDependencies(
  cwd: string,
  opts?: { installCommand?: string; _deps?: EnsureDepsDeps },
): Promise<EnsureDepsResult> {
  const _execFile = opts?._deps?.execFile ?? execFileDefault;
  const _existsSync = opts?._deps?.existsSync ?? fs.existsSync;

  try {
    const command = opts?.installCommand ?? detectInstallCommand(cwd, _existsSync);
    if (!command) {
      return { installed: false, skipped: "no-lockfile" };
    }

    if (_existsSync(path.join(cwd, "node_modules"))) {
      return { installed: false, skipped: "node-modules-exists" };
    }

    await _execFile("/bin/sh", ["-c", command], {
      cwd,
      timeout: INSTALL_TIMEOUT_MS,
    });

    return { installed: true, command };
  } catch {
    return { installed: false };
  }
}

function detectInstallCommand(
  cwd: string,
  existsSync: typeof fs.existsSync,
): string | null {
  for (const [lockfile, command] of LOCKFILE_TO_COMMAND) {
    if (existsSync(path.join(cwd, lockfile))) {
      return command;
    }
  }
  return null;
}
