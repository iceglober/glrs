import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { info, warn } from "./fmt.js";

/**
 * Run a repo-level hook if it exists and is executable.
 *
 * Hook path: `<worktreeDir>/.glrs/hooks/<hookName>`
 *
 * The hook receives the worktree directory as its first argument and
 * any additional env vars passed via the `env` parameter. It runs
 * synchronously — the caller blocks until the hook exits.
 *
 * If the hook doesn't exist, this is a silent no-op.
 * If the hook exists but fails, a warning is printed and execution continues.
 */
export function runHook(
  hookName: string,
  worktreeDir: string,
  env: Record<string, string> = {},
): void {
  const hookPath = path.join(worktreeDir, ".glrs", "hooks", hookName);

  try {
    fs.accessSync(hookPath, fs.constants.X_OK);
  } catch {
    return;
  }

  info(`running .glrs/hooks/${hookName}...`);

  try {
    execFileSync(hookPath, [worktreeDir], {
      cwd: worktreeDir,
      stdio: "inherit",
      timeout: 120_000,
      env: { ...process.env, ...env },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`hook ${hookName} failed: ${msg}`);
  }
}
