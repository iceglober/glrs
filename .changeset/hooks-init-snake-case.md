---
"@glrs-dev/cli": minor
"@glrs-dev/harness-plugin-opencode": patch
---

feat(cli): `glrs harness hooks init` scaffolds example hooks and extensions

- Add `glrs harness hooks init` — writes example `.glrs/hooks/` and `.glrs/extensions/` files to the current repo. Does not overwrite existing files.
- Rename hooks to snake_case: `wt-new` → `wt_new`, `fresh-reset` → `fresh_init`
- Wire all workflow commands (/ship, /fresh, /review, /research, /init-deep) to read `.glrs/extensions/<command>.md`
