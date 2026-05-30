---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): suppress stall detector during in-flight tool calls, add PRIME decomposition rules

- Stall detector now tracks `activeToolCalls` per session — suppresses false-positive nudges while subagents, long-running bash commands, or background tasks are in-flight
- Add mandatory task decomposition guidance to PRIME prompts: per-file subtask rule, multi-package split requirement, concrete examples, and explicit anti-pattern (never dispatch entire phase as one call)
