---
"@glrs-dev/autopilot": minor
"@glrs-dev/cli": minor
---

Remove `--fast` flag. Enrichment now runs unconditionally (idempotent skip when specs already enriched). Per-item execution is the sole strategy with 25-iteration budget and 5-min stall timeout.
