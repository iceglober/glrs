---
"@glrs-dev/harness-plugin-opencode": minor
---

pilot: add `tolerate:` task field + default allowlist for framework-generated files

**Problem:** Tasks with verify steps like `next build` would fail touches-enforcement on files the framework itself rewrites (`next-env.d.ts`, `.next/types/**`), not files the agent edited. The fix-loop couldn't recover — reverting the file just made the next verify regenerate it.

**Fix:** Two complementary escape hatches.

1. **Built-in default allowlist.** `enforceTouches` now accepts a small, opinionated set of framework-generated globs without requiring plan authors to list them:
   - `**/next-env.d.ts`
   - `**/.next/types/**`, `**/.next/dev/types/**`
   - `**/*.tsbuildinfo`
   - `**/__snapshots__/**`, `**/*.snap`

2. **Task-level `tolerate:` field.** Plan authors can extend the allowlist per-task for project-specific codegen (prisma/client, graphql/generated, etc.). `tolerate:` is unioned with `touches:` and defaults at enforcement time.

**Behavior change:** Tasks that previously failed touches-enforcement on these paths will now pass. `touches: []` (verify-only) tasks where ONLY tolerated/default-allowed files change also pass. Real drift (file outside touches + tolerate + defaults) still fails as before.

Planner prompt and `pilot-planning/rules/touches-scope.md` both updated with the new `tolerate:` contract and examples.
