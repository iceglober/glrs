---
"@glrs-dev/autopilot": minor
"@glrs-dev/cli": patch
---

Autopilot recovery: 5 evolving retry attempts on every failure mode (verify, crash, stall, max-iterations) with progressive strategy changes and deep-model escalation. Phases never skip on failure — the run halts if all attempts exhaust.

CLI: fix preflight validation blocking unenriched plans (single-file and directory without spec/) from reaching the enrichment step.
