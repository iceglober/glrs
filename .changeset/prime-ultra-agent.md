---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): add prime-ultra agent with wave-based DAG execution

New `prime-ultra` primary agent that decomposes work into dependency waves and dispatches each wave in parallel. Instead of treating parallelism as all-or-nothing, prime-ultra constructs a full execution DAG before dispatching: `1 → (2,3) → 4 → (5,6,7) → 8` becomes four waves with maximal parallelism at each step.

Wave-based execution applies across ALL SPEAR stages — not just Execute. Scope grounding, planning, building, and verification can all be interleaved as serial and parallel waves.

Also extends the plan format with an `## Execution DAG` section that the @plan agent writes for multi-file plans. The DAG specifies which phases depend on which, enabling prime-ultra to dispatch mechanically rather than re-deriving dependencies at execution time.

Standard `prime` agent is unchanged — users can switch between `prime` and `prime-ultra` in their agent selector.
