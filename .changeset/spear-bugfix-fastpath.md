---
"@glrs-dev/harness-plugin-opencode": patch
---

SPEAR gains a bug-report fast path: diagnose first, small fixes edit directly.

Bench-driven (evalbench, Flash-as-prime): doctrine reliably lost the bugfix task shape — agents diagnosed the root cause then never edited, burning budget on Plan/Execute delegation protocol (0/2 check passes vs a no-doctrine baseline's 2/2). New classification: a bug report is diagnosed BEFORE being sized; a local fix (≤2 files, ~≤30 lines) is edited directly with a targeted test — no delegation — and only systemic fixes take the Substantial path. Explicitly excludes questions-about-code (an earlier wording regressed the question shape ~2 points; the boundary fix recovered it). Measured: bugfix checks 0/2 → 2/4 with no regression on triage (8.45, best on the bench) or question shapes.
