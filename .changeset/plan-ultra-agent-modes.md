---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): add plan-ultra agent, promote designer to primary, demote scoper

- Add `plan-ultra` subagent — writes execution DAGs for wave-based dispatch by prime-ultra. Decoupled from standard `plan` so the two systems don't cross-contaminate.
- Revert DAG additions from standard `plan.md` — standard plan stays clean for standard prime.
- Promote `designer` to primary mode — user-selectable in TUI for direct UI/UX work.
- Demote `scoper` from primary to all — still invocable by users via @scoper, but not in the primary agent selector.
- Demote `plan-ultra` to subagent — only dispatched by prime-ultra, not user-selectable.

Primary agents (TUI selector): prime, prime-ultra, designer.
