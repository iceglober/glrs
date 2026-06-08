---
"@glrs-dev/harness-plugin-opencode": minor
---

The model now sees background-job state on every turn. A new `chat.message` hook appends a compact banner to each user message listing running background jobs (with runtime) and any just-finished job — surfaced once, then dropped — so the agent notices a backfill/migration completed without being told, and without an idle timer or out-of-band injection. Fail-silent; no banner when there are no active jobs.

(Also adds an unpublished TUI sidebar spike under `examples/tui-background-sidebar/` for evaluating opencode's sidebar slot API — see its README.)
