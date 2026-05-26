---
"@glrs-dev/harness-plugin-opencode": patch
---

Speed up PRIME sessions by downgrading gap-analyzer and plan-reviewer from Opus to Sonnet (saves ~40-80s on Plan critical path) and adding mandatory pre-Assess verification that captures session-green timestamps for code-reviewer to skip redundant test/lint/typecheck re-runs.
