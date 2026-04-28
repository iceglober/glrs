---
"@glrs-dev/harness-plugin-opencode": minor
---

Register `research-web`, `research-local`, `research-auto` as OpenCode agents (previously bundled only as skills). `@research` now dispatches by name instead of via a generic subagent loading the Skill tool. Direct invocation (`@research-web`, task-tool dispatch) now works.
