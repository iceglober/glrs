---
"@glrs-dev/autopilot": patch
---

fix(autopilot): validate that phase spec files on disk are referenced in main.yaml

Adds `unreferenced-spec-phase-file` validation error when spec files exist on disk but aren't listed in spec/main.yaml's phases array. Prevents the case where the LLM generates an empty phases array and the executor thinks all work is done.
