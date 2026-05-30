---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): switch cheap tier to GLM 4.7 Flash and add tier to telemetry

- Default cheap-tier model changed from `zai.glm-5` ($1/$3.20) to `zai.glm-4.7-flash` ($0.07/$0.40) — ~12x cheaper than Haiku
- Add `tier` to the telemetry allowlist so `subagent.dispatch` events include the resolved tier (cheap/mid-execute/fast/deep) in TelemetryDeck
- Enables cascade efficacy measurement: correlate cheap-tier dispatches with escalation patterns
