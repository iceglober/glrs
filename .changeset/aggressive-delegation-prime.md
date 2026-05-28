---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): more aggressive delegation from PRIME to subagents

- Replace context firewall with deterministic delegation decision tree (evaluate in order, stop at first match)
- Add `DEFAULT: DELEGATE` iron-law framing with concrete thresholds at every rule
- Add @plan to routing table, multi-file tiebreaker, 2-file edge case handling
- Make reviewer sequencing conditional-explicit with "never batch spec + code reviewer" carve-out
- Add Scope-stage and Plan-stage delegation sections for parallel @code-searcher + @lib-reader dispatch
- Broaden parallel-dispatch plugin to track all subagent types and nudge batching
- Add telemetry for general subagent serial vs parallel dispatch patterns
