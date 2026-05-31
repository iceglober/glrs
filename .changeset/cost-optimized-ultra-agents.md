---
"@glrs-dev/harness-plugin-opencode": minor
---

Add cost-optimized ultra agent series alongside standard agents

**New agent tiers:**

- **Standard** (default): `prime` and `plan` now use the wave-based DAG execution prompt (promoted from former `prime-ultra`/`plan-ultra`). Opus orchestration — same behavior as before, now the default.

- **Ultra** (cost-optimized): `prime-ultra` runs the same prompt on Sonnet (~5x cheaper orchestration), delegating planning to `@plan-ultra` (Opus) and execution to `@build-cheap` (GLM) or `@build` (Sonnet). Validated at 50-60% lower total cost with identical test pass rates.

- **Legacy** (fallback): `prime-legacy` and `plan-legacy` preserve the original non-DAG prompts for workflows that don't need parallel wave dispatch.

**Tier routing architecture:**
- Opus for planning + judgment (high-value architectural reasoning)
- Sonnet for orchestration (rule-following, context construction, dispatch routing)
- GLM for pattern-matching execution (when mirrors exist)

Also includes cascade decomposition prompt improvements and new eval infrastructure for testing cheap model accuracy on real codebases.
