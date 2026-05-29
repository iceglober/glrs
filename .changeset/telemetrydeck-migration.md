---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(telemetry): migrate from PostHog to TelemetryDeck

Replaces the PostHog telemetry backend with TelemetryDeck. Same privacy guarantees (property allowlist, no PII, opt-out via env vars). TelemetryDeck uses a public write-only App ID (no secret needed), making it suitable for open-source distribution. Events use TelemetryDeck's `isTestMode` flag for dev/production separation and `floatValue` for numeric aggregation of durations.
