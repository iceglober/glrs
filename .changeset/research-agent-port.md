---
"@glrs-dev/cli": minor
---

Add `@research` agent and four bundled research skills (`research`, `research-web`, `research-local`, `research-auto`) to the vendored harness-opencode. `@research` is an Opus-class, `mode: all` orchestrator that decomposes research queries into parallel workstreams, dispatches per-workstream sub-agents using one of the four skills (multi-round umbrella, local codebase, web, or autonomous `.lab/` experimentation), reviews findings for gaps, iterates, and synthesizes. The existing `/research` slash command is rewritten as a thin delegator to `@research`; PRIME's subagent-reference recap gains an `@research` entry so its task-tool picker surfaces the agent alongside `@plan`, `@build`, `@code-searcher`, `@qa-reviewer`, etc.
