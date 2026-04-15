# Auto-set branch when claiming a task

## Problem

When `transitionTask` moves a task to `implement` (via `task transition` or `task next --claim`), it sets `claimed_by` but does NOT set the `branch` or `worktree` fields. This means `task current` — which looks up tasks by worktree path then branch name — returns nothing even though the session just claimed the task. Skills that depend on `task current` (every preamble) fail to find their task.

## Solution

When `transitionTask` transitions to `implement`, auto-populate `branch` and `worktree` from the current git state. This makes `task current` work automatically after any claim.

## File Change Table

| File | Change | Exists? |
|------|--------|---------|
| `src/lib/state.ts` | Import `gitSafe` from `./git.js`. In `transitionTask`, when target is `implement`, also set `branch` and `worktree` from git. | Yes |
| `src/lib/state.test.ts` | Add tests verifying branch/worktree are set on implement transition. Mock `gitSafe` for branch detection in test context. | Yes |

## Steps

- [ ] **1.1 — Auto-set branch and worktree in transitionTask on implement**

  **What:** Import `gitSafe` into `state.ts`. In `transitionTask`, when target is `implement`, resolve the current branch via `gitSafe("rev-parse", "--abbrev-ref", "HEAD")` and the worktree via `gitSafe("rev-parse", "--show-toplevel")`. Update the task's `branch` and `worktree` fields in the same UPDATE that sets `claimed_by`/`claimed_at`. Only set these if the task doesn't already have them set (don't overwrite an explicitly-set branch).

  **Import change (src/lib/state.ts:4):**
  ```ts
  // Current:
  import { gitRoot } from "./git.js";
  // New:
  import { gitRoot, gitSafe } from "./git.js";
  ```

  **transitionTask change (src/lib/state.ts:608-614):**
  ```ts
  // Current:
  if (target === "implement") {
    db.run("UPDATE tasks SET claimed_by = ?, claimed_at = ? WHERE repo = ? AND id = ?",
      [opts.actor ?? "cli", now, repo(), id]);
  }

  // New:
  if (target === "implement") {
    const branch = gitSafe("rev-parse", "--abbrev-ref", "HEAD");
    const worktree = gitSafe("rev-parse", "--show-toplevel");
    db.run(
      `UPDATE tasks SET claimed_by = ?, claimed_at = ?,
       branch = COALESCE(branch, ?), worktree = COALESCE(worktree, ?)
       WHERE repo = ? AND id = ?`,
      [opts.actor ?? "cli", now, branch, worktree, repo(), id]);
  }
  ```

  The `COALESCE(branch, ?)` pattern means: if `branch` is already set (non-NULL), keep it; otherwise use the new value. This respects explicit overrides.

  **Test cases (write first):**
  | Layer | Test | Input | Expected |
  |-------|------|-------|----------|
  | Unit | implement sets branch from git | createTask, transition to implement | task.branch matches current git branch |
  | Unit | implement sets worktree from git | createTask, transition to implement | task.worktree matches current git worktree |
  | Unit | implement does not overwrite existing branch | createTask, set branch manually, transition to implement | task.branch is the manually-set value |
  | Unit | implement does not overwrite existing worktree | createTask, set worktree manually, transition to implement | task.worktree is the manually-set value |
  | Unit | task current works after claim | createTask, transition to implement, findCurrentTask(worktree, branch) | returns the task |
  | Unit | findNextTask --claim also sets branch | createEpic, createTask(design), findNextTask with claim | returned task has branch set |
  | Unit | non-implement transitions don't set branch | createTask, transition to design | task.branch is null |

  No auth/access control tests needed — pure internal state function.
  No contract/API tests needed — no HTTP endpoints involved.
  No behavioral/E2E tests beyond the `task current` integration test above.

  **File:** `src/lib/state.test.ts` — add tests
  **File:** `src/lib/state.ts` — modify import, modify `transitionTask`

  **Run:** `bun run typecheck && bun test src/lib/state.test.ts`

## Dependency Graph

```
Step 1.1 (single step, no dependencies)
```

## What this plan does NOT include

- **Auto-clearing branch/worktree on terminal phases** — The branch field is useful metadata even after a task is done (for PR lookups, history). Only `claimed_by` gets cleared.
- **Worktree creation** — This just records the *current* worktree path, it doesn't create new worktrees. That's handled by `gsag wt create`.
- **Updating CLI display** — No display changes needed. Branch/worktree are already shown in `task show`, `task list`, and `status`.
