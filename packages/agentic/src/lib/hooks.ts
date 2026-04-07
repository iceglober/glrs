import { execaSync } from "execa";
import fs from "node:fs";
import path from "node:path";
import { gitRoot } from "./git.js";
import { info, warn } from "./fmt.js";

export interface HookEnv {
  WORKTREE_DIR: string;
  WORKTREE_NAME: string;
  BASE_BRANCH: string;
  REPO_ROOT: string;
}

/** Run a hook script if it exists and is executable. Non-fatal on failure. */
export function runHook(name: string, env: HookEnv): void {
  const hookFile = path.join(gitRoot(), ".glorious", "hooks", name);
  if (!fs.existsSync(hookFile)) return;

  const stat = fs.statSync(hookFile);
  if (!(stat.mode & 0o111)) return; // not executable

  info(`running ${name} hook...`);
  try {
    execaSync("bash", ["-c", 'set +e\nsource "$HOOK_FILE"\ntrue'], {
      stdio: "inherit",
      env: { ...process.env, ...env, HOOK_FILE: hookFile },
    });
  } catch (err: unknown) {
    const code = (err as { exitCode?: number }).exitCode;
    warn(`${name} hook exited with code ${code ?? "unknown"}`);
  }
}
