---
"@glrs-dev/harness-plugin-opencode": minor
---

feat(harness): cost-aware model cascading via cheap-tier agents

Implements [FrugalGPT](https://arxiv.org/abs/2305.05176) (Chen et al. 2023) cost-cascading by adding three new subagents that share prompts with existing agents but run on different models:

- `@build-cheap` — same prompt as `@build`, runs on `amazon-bedrock/zai.glm-5`. Default first dispatch for cost-aware cascading.
- `@build-deep` — same prompt as `@build`, runs on `anthropic/claude-opus-4-7`. Deep escalation tier.
- `@plan-cheap` — same prompt as `@plan`, runs on GLM. For trivial-to-medium plans.

New `cheap` model tier added to `AGENT_TIERS`. Users can override the cheap-tier model in opencode.json via `harness.models.cheap`. Falls back to `fast` tier if unconfigured.

PRIME and PRIME-ultra prompts updated with cascading rules:
- Default dispatch to cheap tier
- Escalate to standard tier on `[FAIL_SPEC]` from `@spec-reviewer`, `BLOCKED` with model-capability signals, or empty output
- Escalate to deep tier on second failure
- Skip cheap entirely for high-risk paths (security/auth/migrations/>10 files of substantial logic)

New `dispatch-tracker` plugin emits `subagent.dispatch` telemetry (subagent name + tier) on every task tool call. Combined with existing `model.token_speed` and `tool.call` outcome events, this gives empirical data to tune cascading thresholds over time.

**Why cheap-tier as separate agents (not a model-override parameter):** OpenCode's `task` tool does not accept a `model` parameter — each AgentConfig has a single hardcoded model. Implementing cascading at the agent level is the only mechanism the platform actually exposes.
