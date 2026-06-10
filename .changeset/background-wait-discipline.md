---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): never strand a session on a dead wait — live-watcher discipline for background jobs

Observed incident: PRIME backgrounded `sleep 180 && <CI check>` (a single-shot timer poll), ALSO ran a foreground `sleep 190` duplicating the same wait, then ended its turn "waiting" — with the background job already exited and zero running watchers. Nothing could ever wake it; the arc hung until the user poked the session.

Three enforcement layers:

- **`background_run` rejects timer polls** (commands leading with `sleep N`) with a teaching error: background a watcher that exits WHEN the condition settles (`gh pr checks --watch`, `gh run watch`, `until <check>; do sleep 30; done && <status>`) — when a fixed delay elapses with the condition unsettled, no watcher remains and the completion ping has nothing left to arm.
- **Foreground-sleep guard** (tool-hooks): bash commands leading with `sleep ≥ 15s` are blocked pre-execution with the same guidance — they burn the turn and usually duplicate an armed watcher. Configurable via `toolHooks.sleepGuard` (`enabled`, `maxSeconds`); short pauses pass through.
- **Live-watcher rule in the PRIME prompts**: hold exactly ONE self-terminating watcher, end the turn with a status line, act on the completion ping immediately — and never end a turn claiming to be "waiting" unless `background_list` shows a RUNNING job whose exit means the wait is over.
