---
"@glrs-dev/harness-plugin-opencode": minor
---

refactor(harness): rename .glorious to .glrs across all paths

Migrates all internal references from `~/.glorious/` to `~/.glrs/`:
- Plan storage: `~/.glrs/opencode/<repo>/plans/`
- Cost tracker: `~/.glrs/opencode/costs.json`
- Hooks: `.glrs/hooks/fresh-reset` (repo-level)
- Worktrees: `~/.glrs/worktrees/`
- Env vars: `GLRS_PLAN_DIR`, `GLRS_COST_TRACKER_DIR`, `GLRS_COST_TRACKER` (legacy `GLORIOUS_*` vars still read as fallback)

External directory permissions allow both `~/.glrs/` and `~/.glorious/` paths for backward compat during migration. Source code, prompts, and tests all updated.
