---
"@glrs-dev/harness-plugin-opencode": patch
---

fix(harness): redesign `configure` TUI for clarity and usability

- Model search shows `provider/model_id` (the actual config value) instead of `provider/Model Name`
- Tier list uses aligned two-column layout: tier name left, value right, with agent list shown on focus
- Configured tiers display in cyan, unconfigured show fallback chain in dim
- Cost display uses explicit `in: $X  out: $Y` format instead of cryptic `$X/$Y`
- Main menu shows compact two-line Models summary (deep + mid) instead of all 6 tiers
- Add `promptSelect` helper supporting rich choices with descriptions and separators
