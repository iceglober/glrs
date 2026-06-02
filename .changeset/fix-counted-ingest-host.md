---
"@glrs-dev/harness-plugin-opencode": patch
"@glrs-dev/cli": patch
---

Fix telemetry: send events to the live Counted ingest host.

The `@counted/sdk` defaults its ingest host to `https://counted.dev`, which has
no DNS record — so every tracked event silently vanished into a failed POST. Both
the CLI and harness analytics now point at the live host `https://app.counted.dev`
(verified to return HTTP 202), overridable via `COUNTED_HOST`. No events were
delivered before this fix.
