---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(telemetry): emit token speed per model as Aptabase events

On each finalized assistant message, emits a `model.token_speed` event with: model ID, provider ID, output token count, generation duration, and tokens/second (tps). No file paths, prompts, or content — just model performance metrics.
