---
"@glrs-dev/harness-plugin-opencode": minor
"@glrs-dev/adapter-opencode": patch
---

Weak-model PRIME hardening — from a 13-experiment eval loop driving Gemini 3.5 Flash as PRIME against a real Linear triage task (baseline composite 3.15 → ~8.1 mean, hour-long runaways eliminated).

- **Loop guards now read and write MCP tool results.** opencode delivers MCP results to `tool.execute.after` as `{content: [...]}` with no `output` key — the repeat/exploration guards could neither hash MCP results (identical-refetch weighting dead) nor inject LOOP WARNINGs the model would ever see. New shape adapters fix both; warnings demonstrably change weak-model behavior once visible.
- **Completed empty assistant turns count as dead turns.** A model that loads a skill and then completes a zero-part continuation killed the session silently in 9s; the stall-detector now nudges these and the session resumes.
- **SPEAR gains an investigate/triage path.** Bare ticket references get a prior-work check (sibling-issue search; completed prior work collapses the task to verify + write-back), evidence-gathering delegates immediately to one bounded `@oracle` consult (with failure fallback), tracker objects are read at most once, and a no-change Resolve path replaces ship mechanics with an explicit write-back + close-as-duplicate proposal — eliminating "verification theater" (typechecks/branch surveys with zero code changes).
- **adapter: permission rejects target the session that raised them.** Auto-reject posted child-session permission prompts to the parent session id — silent 404, child blocked forever, `task` dispatches died with empty errors (~40% of subagent dispatches in headless runs).
- **`applyAgentOverrides` supports per-agent `temperature`** alongside model/prompt.
