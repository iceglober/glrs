---
"@glrs-dev/harness-plugin-opencode": patch
---

Fix parallel subagent dispatch deadlock. The loop guard scored `task` calls for repetition, so N parallel `@build` dispatches — which share a long prompt preamble and collide under the truncated tool signature — could trip the hard-abort threshold. That abort fired `session.abort` on the orchestrator session, cancelling its in-flight sibling subagents ("Task cancelled" at spin-up) and wedging the TUI on the re-plan prompt that followed.

`task` dispatch is now excluded from repeat-loop scoring (delegation is progress, not a loop), and the hard-abort is suppressed whenever any subagent is still in flight on the session.
