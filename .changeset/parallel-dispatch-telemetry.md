---
"@glrs-dev/harness-plugin-opencode": patch
---

Add Aptabase telemetry to parallel-dispatch hook: emits `subagent.dispatch.serial` or `subagent.dispatch.parallel` with `ops_count` on each Execute batch to track how often PRIME uses parallel subagents in production.
