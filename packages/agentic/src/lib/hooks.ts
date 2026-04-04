import { execaSync } from "execa";
import fs from "node:fs";
import path from "node:path";
import { gitRoot } from "./git.js";

export interface HookEnv {
  WORKTREE_DIR: string;
  WORKTREE_NAME: string;
  BASE_BRANCH: string;
  REPO_ROOT: string;
}

/** Run a hook script if it exists and is executable. */
export function runHook(name: string, env: HookEnv): void {
  const hookFile = path.join(gitRoot(), ".glorious", "hooks", name);
  if (!fs.existsSync(hookFile)) return;

  const stat = fs.statSync(hookFile);
  if (!(stat.mode & 0o111)) return; // not executable

  console.log(`\x1b[36m▸\x1b[0m running ${name} hook...`);
  execaSync("bash", [hookFile], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}
