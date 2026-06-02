---
"@glrs-dev/harness-plugin-opencode": patch
---

Reliably deliver telemetry on short and interrupted sessions.

The Counted SDK only flushes buffered events on a 30s timer or once 50 events
accumulate. A session that ends sooner — or is Ctrl-C'd (SIGINT discards the
buffer and `beforeExit` never fires) — lost all of its events. The harness now
flushes on `session.idle` (fired when the agent finishes a turn, before the user
interrupts or closes) and on `session.error`, so events from any real session
actually reach Counted. Bounded and fail-silent; never blocks the session.
