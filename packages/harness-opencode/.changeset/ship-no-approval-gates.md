---
"@glrs-dev/harness-opencode": patch
---

`/ship` now executes end-to-end without firing OS-notification approval prompts at commit, squash, push, or PR creation. Only the declared Stop conditions (non-fast-forward push, pre-commit/pre-push hook failure, unknown working-tree shape, unstaged changes unrelated to the plan) still surface a `question` prompt.

Root cause was a contradiction in the orchestrator prompt, which had a carve-out stating `/ship`'s per-step prompts were "legitimate and stay" — directly overriding ship.md's "no confirmation prompts, just do it" instruction. The carve-out and a related commit-message-review bullet are rewritten to match ship.md's actual contract. ship.md's top-of-file rule also now explicitly suspends the global "YOU MUST use the `question` tool" orchestrator rule for the duration of the command.

Closes #21.
