---
"@glrs-dev/harness-opencode": patch
---

**Fix: reviewers no longer prompt for permission on trivial read-only git commands (`git branch --show-current`, `git status`, etc.).**

Context: users kept hitting `Permission required` asks inside `qa-reviewer`, `qa-thorough`, and `autopilot-verifier` for commands that were explicitly supposed to be allowed. v0.6.0 (commit `c9a288d`) tried to fix this by simplifying the agent-level `permission.bash` from an object-form rule-map to the scalar `"allow"`, but the prompts kept coming.

Root cause: OpenCode's permission resolver merges agent-level `permission.bash` with the **global** `permission.bash` from `applyConfig`. When the agent level was scalar `"allow"` and the global was an object-form rule-map (`{"*": "allow", "git push --force*": "deny", ...}`), the global map was still being re-evaluated on each bash invocation and fell through to an ask for some command shapes — even commands as trivial as `git branch --show-current`. The agent-level scalar was not winning the resolution.

Fix: removed the global `permission.bash` default in `applyConfig` entirely. Subagents that declare `bash: "allow"` now get an unambiguous allow with nothing to fight against. Destructive-command safety is preserved at two surviving layers:

1. **Primary agents (`orchestrator`, `build`) keep their own object-form bash rule-maps** with explicit denies for `rm -rf`, `sudo`, `chmod`, `chown`, `git push --force`, `git push * main`, `git push * master`. These are the only agents that routinely run shell commands with mutation potential, so the safety net is exactly where it's needed.
2. **Read-only subagents (`plan-reviewer`, `code-searcher`, `gap-analyzer`, `architecture-advisor`, `lib-reader`) declare `bash: "deny"`** entirely — bash is off for them regardless.

Reviewers (`qa-reviewer`, `qa-thorough`, `autopilot-verifier`) are read-only by role; their system prompts forbid destructive operations and they never reach for them. The risk surface from dropping the global deny net for them is negligible; the productivity cost of the ask-prompts was severe.

Also updated: relevant test assertions (`applyConfig — permission.bash behavior` block), and the explanatory comments in `src/index.ts` + `src/agents/index.ts` that referenced the now-removed global layer so future maintainers don't try to re-add it without reading the history.
