---
"@glrs-dev/cli": patch
---

Fix two autopilot bugs that surfaced as "Phase file referenced in spec/main.yaml does not exist": pre-flight validation now auto-recovers from stale `spec/` directories, and orphaned phase references in `main.md` are auto-decomposed before enrichment (with a precise actionable error on decomposition failure).
