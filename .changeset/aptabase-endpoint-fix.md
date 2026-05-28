---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(telemetry): use correct Aptabase batch endpoint

The ingestion endpoint was `/api/v0/event` (singular, single object body) — Aptabase's actual API is `/api/v0/events` (plural, array body). The old endpoint returned 200 but silently dropped every event. This is why no events appeared in either the debug or production dashboard.
