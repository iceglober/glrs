---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): more aggressive delegation from PRIME to subagents

- Add delegation-first posture at top of PRIME prompt with a 4-step delegation test applied every turn
- Expand context firewall to cover Scope-stage exploration and pre-Plan grounding
- Add Scope-stage delegation section pushing parallel @code-searcher + @lib-reader dispatch
- Strengthen Plan grounding to delegate multi-area exploration before @plan dispatch
- Broaden parallel-dispatch plugin to track ALL subagent types (not just @build) and nudge batching
- Add telemetry for general subagent serial vs parallel dispatch patterns
