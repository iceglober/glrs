# Wave 1 — Unify plan-paths.ts + shell execution via execa

**Focus:** Consolidate the triplicated `plan-paths.ts` into shared, and replace all `promisify(execFile)` / `Bun.spawnSync` / raw `spawn` patterns with `execa`.

---

## Items

- [ ] 1.1 **Add `execa` to shared.** Already declared in 0.1's package.json. Verify it resolves. Create `packages/shared/src/exec.ts` with two helpers:

  ```typescript
  import { execa, execaSync } from "execa";

  /** Run a command asynchronously. Returns { stdout, stderr }. Throws on non-zero exit. */
  export async function run(cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string }>;

  /** Run a command synchronously. Returns stdout. Throws on non-zero exit. */
  export function runSync(cmd: string, args: string[], opts?: { cwd?: string }): string;

  /** Run git asynchronously in a directory. */
  export async function git(cwd: string, ...args: string[]): Promise<string>;

  /** Run git synchronously in a directory. Returns null on failure. */
  export function gitSync(cwd: string, ...args: string[]): string | null;
  ```

  - files (NEW): `packages/shared/src/exec.ts`
  - files (MODIFIED): `packages/shared/src/index.ts`
  - verify: `cd packages/shared && bun test`

- [ ] 1.2 **Tests for exec helpers.** Test `git` (async, real git commands), `gitSync` (sync, null on failure), `run` (timeout, non-zero exit throws), `runSync`.

  - files (NEW): `packages/shared/test/exec.test.ts`
  - verify: `cd packages/shared && bun test`

- [ ] 1.3 **Consolidate plan-paths.ts.** Move `packages/cli/src/plan-paths.ts` (the most complete version, with `GLRS_PLAN_DIR` + `GLORIOUS_PLAN_DIR` fallback) to `packages/shared/src/plan-paths.ts`. Parameterize the base directory and env var names so callers can configure:

  ```typescript
  export function getPlanDir(opts?: {
    envVar?: string;        // default: "GLRS_PLAN_DIR"
    legacyEnvVar?: string;  // default: "GLORIOUS_PLAN_DIR"
    baseDir?: string;       // default: "~/.glrs/opencode"
    legacyBaseDir?: string; // default: "~/.glorious/opencode"
  }): string;
  ```

  Replace the `execFile` calls inside plan-paths with the new `git()` helper from `exec.ts`.

  - files (NEW): `packages/shared/src/plan-paths.ts`
  - files (MODIFIED):
    - `packages/autopilot/src/plan-paths.ts` → re-export shim from `@glrs-dev/shared`
    - `packages/harness-opencode/src/plan-paths.ts` → re-export shim
    - `packages/cli/src/plan-paths.ts` → re-export shim
  - verify: `cd packages/autopilot && bun test && cd ../harness-opencode && bun test && cd ../cli && bun test`

- [ ] 1.4 **Migrate autopilot git-safety.ts to execa.** Replace `promisify(execFile)("git", ...)` with `git(cwd, ...)` from shared. The injectable `deps.execGit` pattern stays for testing — just change the default implementation.

  - files (MODIFIED): `packages/autopilot/src/git-safety.ts`
  - verify: `cd packages/autopilot && bun test test/git-safety.test.ts`

- [ ] 1.5 **Migrate autopilot worktree.ts to execa.** Replace 11 `execFile` call sites with `git()` from shared.

  - files (MODIFIED): `packages/autopilot/src/worktree.ts`
  - verify: `cd packages/autopilot && bun test test/worktree.test.ts`

- [ ] 1.6 **Migrate autopilot auto-ship.ts to execa.** Replace `execFile("git", ...)` and `execFile("gh", ...)` with `run()` / `git()` from shared.

  - files (MODIFIED): `packages/autopilot/src/auto-ship.ts`
  - verify: `cd packages/autopilot && bun test test/auto-ship.test.ts`

- [ ] 1.7 **Migrate autopilot verify-runner.ts to execa.** Replace `/bin/sh -c` spawn with `run()` from shared. The 5-minute timeout maps to execa's `timeout` option.

  - files (MODIFIED): `packages/autopilot/src/verify-runner.ts`
  - verify: `cd packages/autopilot && bun test test/verify-runner.test.ts`

- [ ] 1.8 **Migrate cli/src/lib/git.ts to execa.** Replace `Bun.spawnSync` with `runSync()` / `gitSync()` from shared. Keep the same function signatures (`git()`, `gitSafe()`, `gitIn()`, `gitInSafe()`) — just change the implementation.

  - files (MODIFIED): `packages/cli/src/lib/git.ts`
  - verify: `cd packages/cli && bun test`
