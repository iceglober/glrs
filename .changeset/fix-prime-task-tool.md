---
"@glrs-dev/harness-plugin-opencode": patch
---

Enable task tool on PRIME agents so parallel subagent dispatch actually works

PR #85 added parallel build dispatch instructions to the PRIME prompt but
never added `tools: { task: true }` to the agent config. The OpenCode SDK
strips the task tool by default — without explicit opt-in, PRIME could not
dispatch `@build` subagents at all. Fixed for `prime`, `autopilot-prime`,
and `autopilot-fast`.
