---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): local dispatch tracker, remove TelemetryDeck, disable cheap cascading

- Remove TelemetryDeck telemetry entirely — no data leaves the machine
- Replace telemetry-based dispatch tracking with local file-based tracker (`~/.glrs/opencode/dispatches.jsonl` + `dispatches.json`)
- Add `/dispatches` command to view agent dispatch counts by tier and agent
- Disable cheap-tier cascading in PRIME prompts — @build/@plan (standard tier) is now the default dispatch target. Cheap cascading caused production failures (git conflicts, scope confusion, truncated output from GLM models on multi-package tasks)
