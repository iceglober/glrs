---
"@glrs-dev/harness-opencode": patch
---

Fix: silence bash ask-prompts for qa-reviewer, qa-thorough, orchestrator, and build

Switch the agent-level `permission.bash` from scalar `"allow"` to an object-form map with an enumerated allow-list of non-destructive commands (`pnpm lint *`, `tail *`, `ls *`, `git diff *`, `git merge-base *`, `git log *`, `bunx *`, etc.). Live log evidence (commits c9a288d/3483448 notwithstanding) confirmed an upstream OpenCode layer injects `{bash, *, ask}` that beats our scalar `allow` via last-match-wins in `Permission.evaluate`. Specific-pattern keys sort later in the ruleset and win.

Destructive-command denies (`rm -rf /`, `chmod`, `chown`, `sudo`, `git push --force`) are preserved; `git push --force-with-lease` remains an explicit re-allow.

Also ships a gated diagnostic probe: set `HARNESS_OPENCODE_PERM_DEBUG=1` to dump every agent's final permission block to `$XDG_STATE_HOME/harness-opencode/perm-debug.json`. Silent and zero-overhead when unset. Use it to verify the fix on your machine or to diagnose future permission-resolution issues.
