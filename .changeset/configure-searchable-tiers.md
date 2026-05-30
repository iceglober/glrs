---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): searchable model picker and full tier coverage in `configure`

- Replace the two-step provider→model selection with a single searchable list (type to filter by provider, model name, or cost)
- Add missing `cheap` tier so cascading-first-pass models are configurable
- Show all 6 tiers (deep, mid, mid-execute, autopilot, fast, cheap) with their agent lists and fallback chains
- Fetch models once per session instead of per-tier-change
