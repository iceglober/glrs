---
"@glrs-dev/harness-opencode": patch
---

Make `pilot build` failures diagnosable from the terminal alone: failure phase and reason now print inline beneath each `task.failed` line, the run summary includes a per-failed-task detail block with session id and preserved worktree path, and the blocked-cascade is de-noised to one summary line instead of one scary line per blocked task.

Also fixes two supporting bugs: a preserved-on-failure worktree slot no longer poisons every subsequent task in the run, and `pilot status --run <id>` / `pilot logs --run <id>` now resolve the state DB from any worktree (or any repo under the same pilot base), so you can investigate a failed run from wherever you happen to be checked out.
