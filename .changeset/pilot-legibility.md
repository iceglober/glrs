---
"@glrs-dev/harness-opencode": minor
---

Pilot build: richer stdout progress. `task.verify.failed` now shows attempt/command/exit; `task.failed`/`task.stopped` emit a `pilot logs` breadcrumb; cascade-blocked tasks render inline with the failed upstream dep; retry attempts surface a low-key tick. No config or payload breaking changes.
