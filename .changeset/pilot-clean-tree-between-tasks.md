---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot: clean the working tree after every task (success OR failure)

The worker now guarantees the tree is pristine between tasks. After every task the worker runs `git reset --hard HEAD && git clean -fd` (preserves `.gitignored`). This makes the tree-clean-between-tasks invariant explicit: `git status --porcelain` is empty before the next task starts.

- **Success paths** already had this implicitly via `commitAll`. No behavior change — the reset is a no-op on an already-clean tree.
- **Failure paths** previously left partial agent edits in the working tree. Now they're reverted. The forensic record of what the failed task did lives in `runs/<runId>/tasks/<taskId>/session.jsonl` — unchanged.

Consequences:

1. `pilot build-resume` no longer trips on a dirty tree left behind by the failed run — the failed task's own cleanup already handled it. Resume just works.
2. Subsequent tasks in the same run start from a known-clean state. No more "task B silently ran on top of task A's partial edits."
3. If the post-task cleanup itself fails (locked ref, permissions), the worker halts the whole run with a clear error and emits a `run.cleanup.failed` event. Subsequent tasks cannot safely run on a mixed tree.

Users who need to inspect what a failed task produced should open the session's JSONL log under `~/.glorious/opencode/<repo>/pilot/runs/<runId>/tasks/<taskId>/session.jsonl` — the git diff is no longer the canonical record.
