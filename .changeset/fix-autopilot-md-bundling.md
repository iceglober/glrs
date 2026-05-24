---
"@glrs-dev/cli": patch
---

Fix `glrs autopilot --plan …` failing with `Unknown enrichment strategy "default"` on clean installs. The autopilot package's tsup build now correctly bundles `strategies/default.md` and `prompt-template.md` into `dist/`, so the vendored CLI artifact ships with the runtime markdown assets it needs.
