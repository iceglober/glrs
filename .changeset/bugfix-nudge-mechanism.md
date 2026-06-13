---
"@glrs-dev/harness-plugin-opencode": minor
---

Bug fixes that weak primes diagnose-but-never-finish now get a mechanical "fix now" nudge.

The prose SPEAR bug-report fast path (3.18.1) triggered only ~50% of the time on weak models — they'd locate the root cause, the generic exploration guard would fire, and they'd state a hypothesis instead of editing. The harness now classifies task shape from the first user message in code (a bug report — a misbehaving system to make stop — vs a question about code, which is excluded) and, when a bug-shaped session accumulates read/search calls with zero edits, injects a shape-specific "EDIT the file now and run the test" corrective through the same visible loop-guard channel weak models demonstrably obey.

Bench-measured (evalbench, Gemini Flash as prime, A/B on one binary toggled by config, n=4): bug-fix verify-pass rate **25% → 75%**, the budget-runaway failure mode eliminated (3/4 baseline runs hit the wall; 0/4 with the nudge), at lower cost — with zero false fires on question or triage tasks. Tunable via `toolHooks.loopDetection.bugFixWarn` (default 5 passive calls; 0 disables).
