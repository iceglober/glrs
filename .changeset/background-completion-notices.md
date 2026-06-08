---
"@glrs-dev/harness-plugin-opencode": minor
---

Re-add background-job completion awareness for the model — the safe way (the 3.12.0 banner that broke first messages is not coming back). When a background job started in the current session finishes, a one-line notice is appended to the NEXT tool call's output (the same channel as backpressure/loop-guard correctives) — never the user message, so there's no part-schema or persisted-history problem. Session-scoped (a job's stamped sessionID must match; global/legacy jobs are not announced), announced once, and capped (overflow points at `background_list`). The model sees a completion inline with its next action; the sidebar continues to cover the human.
