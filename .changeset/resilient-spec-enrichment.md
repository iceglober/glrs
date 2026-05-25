---
"@glrs-dev/autopilot": patch
---

fix(autopilot): resilient spec enrichment with LLM-based validation+repair loop

Pass actual phase filenames to the main.yaml generation prompt so the LLM uses correct references instead of inventing simplified names. After enrichment, validate the spec and send any errors back to the LLM for repair, looping until validation passes or the repair budget is exhausted.
