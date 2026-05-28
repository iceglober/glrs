---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(telemetry): migrate from Aptabase to PostHog

Replaces the Aptabase telemetry backend with PostHog. Same privacy guarantees (property allowlist, no PII, opt-out via env vars), but PostHog supports property-level breakdowns, filtering, and grouping in the dashboard — enabling analysis like token speed by model.
