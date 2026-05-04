---
"@glrs-dev/harness-plugin-opencode": minor
---

Pilot redesign Steps 1–2: introduce polymorphic Gate abstraction (`shell`, `all`, `any` composite gates with `evalGate` dispatcher) and add v2 SQLite migration for multi-phase workflow state (`workflows`, `phases`, `artifacts` tables). Existing `runs`/`tasks`/`events` schema and accessors preserved with `@deprecated` markers; backfill creates synthetic single-build-phase workflows from legacy rows.
