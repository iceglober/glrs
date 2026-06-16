---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/cli": patch
---

agents: support repo-local prompt extensions via `.glrs/extensions/agents/<agent>.md`

The `.glrs/extensions/` convention — already appended to slash-command prompts — now also applies to agent prompts, namespaced under `agents/`. A repo drops `.glrs/extensions/agents/prime.md` (or any agent name) and its content is appended to that agent's system prompt under a `## Extension (from …)` heading. This is how vendor specifics stay OUT of the harness: the bundled prompts teach portable doctrine ("wait by arming a watcher whose wake condition is the first state you'd act on"); a repo supplies its local fact ("our CI is GitHub Actions; `gh pr checks <pr> --watch --fail-fast` wakes me on the first check failure").

Commands stay flat (`.glrs/extensions/<command>.md`) for backward compatibility; agents live under `agents/` so they never collide with a same-named command (`research` is both) and so one-shot command instructions stay separate from persistent agent-prompt methodology.

The reader (`readExtension`) was lifted from `commands/index.ts` into a shared `src/extensions.ts` and is now called by both commands and agent assembly — one function, two callers, no duplication. The agent append runs last in `applyConfig`, after model resolution and agent overrides, so it survives prompt replacements (`getStrictPrompt`, `agents.<name>.prompt` overrides). `glrs harness hooks init` now scaffolds an example `extensions/agents/prime.md`.
