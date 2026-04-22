---
"@glrs-dev/harness-opencode": patch
---

Fix two P0 bugs in `/fresh` reported in [#54](https://github.com/iceglober/harness-opencode/issues/54):

- **Rendered prompt coherence.** OpenCode substitutes `$ARGUMENTS` into slash-command prompts wherever the token appears. Our prompts embedded it multiple times as self-reference ("Parse `$ARGUMENTS`", "If `$ARGUMENTS` is empty"), which turned long inputs (URLs, full sentences) into gibberish in the rendered prompt body. Rewrote `fresh.md`, `ship.md`, `autopilot.md`, `review.md`, and `costs.md` to substitute `$ARGUMENTS` exactly once at the top of each file and use semantic referents ("the user's input", "the plan path") everywhere else. Matches the pattern already used in `research.md` and `init-deep.md`. New CI test (`test/prompts-no-dangling-paths.test.ts`) enforces `$ARGUMENTS` occurs at most once per command prompt.
- **`/fresh` unblocked under default permissions.** Orchestrator permissions now `allow` `git clean *` and `git reset --hard*` (previously `deny` and `ask`). `/fresh`'s destructive-reset step couldn't complete because `git clean` was hard-denied; and `git reset --hard` double-confirmed on top of `/fresh`'s own `question`-tool gate. Both permission-layer prompts were redundant noise for an orchestrator-scoped invocation. Global bash permissions (for user-typed commands) and build-agent permissions are unchanged — the relaxation is orchestrator-scoped.
