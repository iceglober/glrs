---
"@glrs-dev/harness-plugin-opencode": minor
---

Remove the broken `plan-dir` and `plan-check` CLI subcommands and fix `@plan`'s write permission

The `bunx @glrs-dev/harness-plugin-opencode plan-dir` and `plan-check` subcommands had been dead since the standalone-invocation redirect guard was introduced in April 2026 — they exit 1 with a deprecation banner and produce no stdout when an agent invokes them via `bunx`. Every caller silently fell through, so this surface was not load-bearing. This release rips both subcommands (and the bundled `plan-check.sh` script) out of the CLI. Agents that previously resolved the plan directory via `plan-dir` now use a four-line inline bash snippet that composes `git rev-parse --git-common-dir`, `dirname`, `basename`, and `mkdir -p` to compute `~/.glorious/opencode/<repo-folder>/plans/` directly (honoring `$GLORIOUS_PLAN_DIR` as an override base). The `plan-paths.ts` library module and its `getRepoFolder`, `getPlanDir`, `migratePlans` exports remain — they were never the broken piece.

Companion fix: `@plan`'s permission block was missing `write: "allow"`, which prevented the agent from ever creating a plan file even when `plan-dir` was conceptually working. The permission now grants `write: "allow"` plus a four-entry bash allow-list covering only the commands the inline snippet needs. The "plan writes only plan files" invariant is preserved at the prompt layer (hard-rules section).

If you were calling `bunx @glrs-dev/harness-plugin-opencode plan-dir` or `plan-check` directly in a script, switch to either (a) the inline bash snippet above or (b) importing `getPlanDir` / `migratePlans` from the library if you're writing TypeScript.
