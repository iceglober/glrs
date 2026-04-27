---
"@glrs-dev/harness-opencode": minor
---

Add `@research` agent and four bundled research skills (`research`, `research-web`, `research-local`, `research-auto`) to the harness. Previously lived as generator files in the deprecated `@glrs-dev/agentic` package; this moves them into the harness as first-class shipped assets. The existing `/research` slash command is rewritten as a thin delegator to `@research`.
