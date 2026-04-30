---
"@glrs-dev/harness-plugin-opencode": major
---

pilot: scorched-earth rollback of worktree isolation — cwd mode is the only execution shape

**Breaking change.** The pilot subsystem no longer manages a per-task worktree pool. `pilot build` now runs each task directly in the user's current worktree (`process.cwd()`), committing on HEAD of the user's feature branch after each task's verify passes.

User-visible changes:

- **Pre-flight safety gate.** `pilot build` refuses to run when the working tree is on `main`/`master`/the remote's default branch, outside a git repo, or has uncommitted changes. Match `/fresh --yes` semantics.
- **`setup:` field removed.** Plans that declare a top-level `setup:` array fail `pilot validate` with a friendly message pointing at `src/pilot/AGENTS.md`. Users should run setup manually (install, compose, migrate, seed) before invoking `pilot build`.
- **CLI verbs removed.** `pilot resume`, `pilot retry`, and `pilot worktrees` are deleted. cwd-mode resume/retry semantics are future work.
- **No `PILOT_*` env injection.** Verify commands inherit `process.env` verbatim. The COMPOSE_PROJECT_NAME default is gone.
- **Auto-commit contract preserved.** The worker still auto-commits after each successful task — just on HEAD of the user's current branch instead of a throwaway per-task branch.

Internal:

- Deleted `src/pilot/worktree/` directory and its `pool.ts`/`git.ts` modules.
- New `src/pilot/worker/safety-gate.ts` with `checkCwdSafety()`.
- `enforceTouches()` now takes `cwd` instead of `worktree`.
- Plan schema uses `.passthrough().superRefine(...)` to surface the friendly setup-removal message alongside standard unknown-key rejection.
- `pilot-planning` skill is now 9 rules (was 10); `setup-authoring.md` deleted.
