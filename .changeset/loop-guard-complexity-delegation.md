---
"@glrs-dev/harness-plugin-opencode": minor
---

Add a complexity-delegation hint to the tool-loop guard, and broaden PRIME's escalation rule to match.

A signal distinct from the existing loop signatures (repeated calls / passive-exploration streaks / silent stalls): when the agent does real work but **test/build runs keep failing** across attempts — even with *different* errors each time — that's the fingerprint of grinding on inherent complexity. After enough failing verify runs (default 4) with no delegation, the guard injects a one-time, soft suggestion (never an abort) to hand the problem to a deeper-reasoning subagent (default `@build-deep`). Suppressed once the agent delegates via the `task` tool.

- New `loopDetection.complexityWarn` (default 4; 0 disables) and `loopDetection.deepAgent` (default `@build-deep`) config.
- Emits `loop_detected` telemetry with `kind: "complexity"`.
- PRIME (`prime-ultra`) escalation rule now also covers the "distinct-failure grind" — ~4+ failing verify runs without convergence — not just the "same error twice" loop, including when the task was started inline and never entered the build cascade.
