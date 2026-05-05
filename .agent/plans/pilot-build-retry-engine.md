# Pilot build-phase retry engine

## Goal
Replace the pilot worker's naive "retry the same approach up to 5 times" loop with an intelligent retry engine that classifies failures, runs a Haiku-based critic to produce targeted fix guidance, applies a diversification ladder (escalating strategy changes per attempt), and enforces circuit breakers (cost, wall-time, signature-recurrence). All behind defaulted plan flags so existing `pilot.yaml` plans keep their current behavior unchanged.

## Constraints
- Backward compatibility: existing plans without new fields behave identically (all new `defaults.*` fields have status-quo defaults)
- LLM-based classify/critic must be mockable — tests use fixture inputs and mock LLM responses, never call real APIs
- The worker.ts refactor is incremental — engine.ts extracts the per-attempt retry intelligence; worker.ts keeps session lifecycle, baseline verify, and post-task cleanup
- Circuit breakers are cumulative across attempts within a run (not per-task for cost/wall-time)
- All 1262+ existing tests must continue to pass
- No new runtime dependencies beyond what's already in the package

## Acceptance criteria

```plan-state
- [x] id: a1
  intent: Verify failures are classified into one of five categories (transient,
          environmental, logical, plan-divergent, budget) using output heuristics,
          with an LLM fallback for ambiguous cases. Classification determines
          whether to retry immediately, invoke the critic, or trip a circuit breaker.
  tests:
    - packages/harness-opencode/test/pilot-build-classify.test.ts::"classifies ECONNRESET as transient"
    - packages/harness-opencode/test/pilot-build-classify.test.ts::"classifies missing binary as environmental"
    - packages/harness-opencode/test/pilot-build-classify.test.ts::"classifies test assertion failure as logical"
    - packages/harness-opencode/test/pilot-build-classify.test.ts::"classifies scope-violation hint as plan-divergent"
    - packages/harness-opencode/test/pilot-build-classify.test.ts::"classifies cost-exceeded as budget"
    - packages/harness-opencode/test/pilot-build-classify.test.ts::"falls back to LLM for ambiguous output"
  verify: cd packages/harness-opencode && bun test test/pilot-build-classify.test.ts

- [x] id: a2
  intent: A Haiku-based critic produces a structured report (smallestFix,
          narrowScope, riskFlags) from the failure context. The report is emitted
          as a task.critic.report event and fed into the enriched fixPrompt so the
          builder agent receives targeted guidance instead of raw failure output.
  tests:
    - packages/harness-opencode/test/pilot-build-critic.test.ts::"returns structured CriticReport from mock LLM"
    - packages/harness-opencode/test/pilot-build-critic.test.ts::"emits task.critic.report event"
    - packages/harness-opencode/test/pilot-build-critic.test.ts::"skipped when reflexion is disabled"
    - packages/harness-opencode/test/pilot-build-critic.test.ts::"handles LLM timeout gracefully"
  verify: cd packages/harness-opencode && bun test test/pilot-build-critic.test.ts

- [x] id: a3
  intent: A diversification ladder escalates retry strategy based on attempt
          number and failure class. "none" preserves current behavior; "standard"
          adds critic + narrow-scope; "aggressive" adds model-swap and
          fresh-subagent. Each escalation emits a task.diversify.applied event.
  tests:
    - packages/harness-opencode/test/pilot-build-diversify.test.ts::"none mode returns same-strategy for all attempts"
    - packages/harness-opencode/test/pilot-build-diversify.test.ts::"standard mode escalates through critic then narrow-scope"
    - packages/harness-opencode/test/pilot-build-diversify.test.ts::"aggressive mode reaches model-swap and fresh-subagent"
    - packages/harness-opencode/test/pilot-build-diversify.test.ts::"transient failures skip critic step"
  verify: cd packages/harness-opencode && bun test test/pilot-build-diversify.test.ts

- [x] id: a4
  intent: Circuit breakers halt retry loops when cumulative cost exceeds the
          configured cap, wall-time exceeds the run limit, or the same failure
          signature recurs 3+ times. Each trip emits a task.circuit.tripped event
          with the breaker type and threshold.
  tests:
    - packages/harness-opencode/test/pilot-build-circuit.test.ts::"trips on cumulative cost exceeding max_total_cost_usd"
    - packages/harness-opencode/test/pilot-build-circuit.test.ts::"trips on wall-time exceeding max_run_wall_ms"
    - packages/harness-opencode/test/pilot-build-circuit.test.ts::"trips on signature recurrence (3 identical failures)"
    - packages/harness-opencode/test/pilot-build-circuit.test.ts::"does not trip when thresholds not reached"
  verify: cd packages/harness-opencode && bun test test/pilot-build-circuit.test.ts

- [x] id: a5
  intent: Retry strategy controls whether partial work is preserved (keep) or
          discarded (reset) between attempts. "reset" matches current behavior
          (git reset --hard). "keep" preserves work on a scratch branch for the
          next attempt to build on.
  tests:
    - packages/harness-opencode/test/pilot-build-retry-strategy.test.ts::"reset mode discards working tree changes"
    - packages/harness-opencode/test/pilot-build-retry-strategy.test.ts::"keep mode preserves changes on scratch branch"
    - packages/harness-opencode/test/pilot-build-retry-strategy.test.ts::"defaults to reset when not configured"
  verify: cd packages/harness-opencode && bun test test/pilot-build-retry-strategy.test.ts

- [x] id: a6
  intent: The engine orchestrator replaces the attempt-loop body in worker.ts,
          routing failures through classify → critic → diversify →
          retry-strategy → enriched fixPrompt. Worker.ts delegates to engine.ts
          for per-attempt logic while retaining session lifecycle and cleanup.
  tests:
    - packages/harness-opencode/test/pilot-build-engine.test.ts::"routes transient failure to immediate retry without critic"
    - packages/harness-opencode/test/pilot-build-engine.test.ts::"routes logical failure through full pipeline"
    - packages/harness-opencode/test/pilot-build-engine.test.ts::"respects circuit breaker and halts"
    - packages/harness-opencode/test/pilot-build-engine.test.ts::"defaults produce identical behavior to current worker"
  verify: cd packages/harness-opencode && bun test test/pilot-build-engine.test.ts

- [x] id: a7
  intent: The plan schema accepts new optional defaults (critic_model, reflexion,
          diversify, retry_strategy, max_total_cost_usd, max_run_wall_ms) and
          per-task fields (max_wall_ms, alt_model) without breaking existing
          plans. All new fields have backward-compatible defaults.
  tests:
    - packages/harness-opencode/test/pilot-plan-schema.test.ts::"parses plan with new retry defaults"
    - packages/harness-opencode/test/pilot-plan-schema.test.ts::"existing plan without new fields still parses"
    - packages/harness-opencode/test/pilot-plan-schema.test.ts::"rejects invalid diversify value"
  verify: cd packages/harness-opencode && bun test test/pilot-plan-schema.test.ts

- [x] id: a8
  intent: The fixPrompt incorporates critic report (smallestFix, narrowScope) when
          available, giving the builder agent structured guidance instead of only
          raw failure output.
  tests:
    - packages/harness-opencode/test/pilot-build-engine.test.ts::"enriched fixPrompt includes critic smallestFix"
    - packages/harness-opencode/test/pilot-build-engine.test.ts::"fixPrompt without critic matches current format"
  verify: cd packages/harness-opencode && bun test test/pilot-build-engine.test.ts

- [x] id: a9
  intent: All existing pilot tests continue to pass with the refactored code.
          The worker delegates to engine.ts but external behavior is unchanged
          when new defaults are not set.
  tests:
    - packages/harness-opencode/test/pilot-worker.test.ts::"all existing tests"
    - packages/harness-opencode/test/pilot-worker-events.test.ts::"all existing tests"
  verify: cd packages/harness-opencode && bun test test/pilot-worker.test.ts test/pilot-worker-events.test.ts
```

## File-level changes

### `packages/harness-opencode/src/pilot/build/classify.ts` (NEW)
- Change: Create failure classifier with heuristic rules and optional LLM fallback
- Why: Maps raw verify output to a `FailureClass` enum that drives downstream retry decisions
- Risk: low — pure function with deterministic heuristics; LLM path is optional fallback

### `packages/harness-opencode/src/pilot/build/critic.ts` (NEW)
- Change: Create Haiku-based critic that produces `CriticReport { smallestFix, narrowScope, riskFlags }`
- Why: Turns "retry harder" into "retry with a targeted smallest-fix suggestion"
- Risk: medium — LLM call introduces latency and potential failure; must handle timeouts gracefully

### `packages/harness-opencode/src/pilot/build/diversify.ts` (NEW)
- Change: Create strategy ladder (`same → critic → narrow-scope → model-swap → fresh-subagent`) keyed off `defaults.diversify`
- Why: Escalates approach when repeated retries fail, avoiding the "same error, same fix" loop
- Risk: low — pure function mapping (attempt, failureClass, config) → DiversifyAction

### `packages/harness-opencode/src/pilot/build/circuit.ts` (NEW)
- Change: Create circuit breakers for cumulative cost, wall-time, and signature-recurrence
- Why: Prevents runaway cost and infinite loops when the agent is stuck
- Risk: low — stateful but simple threshold checks; signature hashing is deterministic

### `packages/harness-opencode/src/pilot/build/retry-strategy.ts` (NEW)
- Change: Create `keep` vs `reset` tree-state management between attempts
- Why: Allows preserving partial work (keep) or clean-slate retries (reset)
- Risk: medium — `keep` mode involves git branch operations that must not corrupt the worktree

### `packages/harness-opencode/src/pilot/build/engine.ts` (NEW)
- Change: Create per-attempt orchestrator that chains classify → critic → diversify → retry-strategy → enriched fixPrompt
- Why: Single entry point for the retry intelligence pipeline, called by worker.ts in place of the current inline attempt-loop body
- Risk: medium — integration point; must correctly wire all sub-modules and handle edge cases

### `packages/harness-opencode/src/pilot/plan/schema.ts`
- Change: Add optional fields to `DefaultsSchema` (`critic_model`, `reflexion`, `diversify`, `retry_strategy`, `max_total_cost_usd`, `max_run_wall_ms`) and `TaskSchema` (`max_wall_ms`, `alt_model`), all with backward-compatible defaults
- Why: Plan authors opt into retry intelligence via declarative config
- Risk: low — additive schema changes with `.default()` values; existing plans parse unchanged

### `packages/harness-opencode/src/pilot/opencode/prompts.ts`
- Change: Extend `LastFailure` type with optional `criticReport` field; update `fixPrompt` to render critic guidance (smallestFix, narrowScope) when present
- Why: The builder agent needs structured fix guidance, not just raw failure output
- Risk: low — additive type change; existing callers pass no criticReport and get current behavior

### `packages/harness-opencode/src/pilot/worker/worker.ts`
- Change: Extract the attempt-loop body (lines ~630–900) into a call to `engine.runAttempt(...)`. Worker retains session creation, baseline verify, the outer attempt counter, and post-task cleanup.
- Why: Separates retry intelligence (engine) from task lifecycle (worker)
- Risk: medium — refactoring a 1000-line file; must preserve all event emissions, error paths, and cleanup guarantees

### `packages/harness-opencode/test/pilot-build-classify.test.ts` (NEW)
- Change: Unit tests for failure classification heuristics and LLM fallback (mocked)
- Why: Validates each FailureClass is correctly assigned from representative outputs
- Risk: none

### `packages/harness-opencode/test/pilot-build-critic.test.ts` (NEW)
- Change: Unit tests for critic report generation with mocked LLM responses
- Why: Validates structured output parsing, event emission, and error handling
- Risk: none

### `packages/harness-opencode/test/pilot-build-diversify.test.ts` (NEW)
- Change: Unit tests for the diversification ladder at each config level
- Why: Validates escalation logic for none/standard/aggressive modes
- Risk: none

### `packages/harness-opencode/test/pilot-build-circuit.test.ts` (NEW)
- Change: Unit tests for all three circuit breaker types
- Why: Validates threshold detection and trip semantics
- Risk: none

### `packages/harness-opencode/test/pilot-build-retry-strategy.test.ts` (NEW)
- Change: Unit tests for keep vs reset tree-state management
- Why: Validates git operations for both modes
- Risk: none

### `packages/harness-opencode/test/pilot-build-engine.test.ts` (NEW)
- Change: Integration tests for the full pipeline with mocked sub-modules
- Why: Validates end-to-end routing and that defaults produce current behavior
- Risk: none

### `packages/harness-opencode/test/pilot-plan-schema.test.ts`
- Change: Add test cases for new schema fields (valid values, defaults, rejection of invalid values)
- Why: Validates schema accepts new fields without breaking existing plan parsing
- Risk: none

### `packages/harness-opencode/src/pilot/AGENTS.md`
- Change: Add `build/` directory entry to the Layout section
- Why: Documents the new module directory per the repo's convention of keeping AGENTS.md in sync with directory structure
- Risk: none

## Test plan
- Each new module (`classify`, `critic`, `diversify`, `circuit`, `retry-strategy`) gets a dedicated unit test file with fixture-driven inputs and mocked LLM responses
- `engine.test.ts` is an integration test that mocks the sub-modules and validates the full pipeline routing
- Existing `pilot-worker.test.ts` and `pilot-worker-events.test.ts` must pass unchanged (regression gate)
- `pilot-plan-schema.test.ts` gains new cases for the additive schema fields
- Manual smoke: run `pilot build` against a fixture plan with a deliberately-flaky verify command; observe classify routing in event log and circuit breaker tripping

## Out of scope
- LLM gates as a first-class `Gate` union member (Step 4+ concern)
- Multi-worker parallelism (v0.1 clamps to 1 worker)
- Cost preemption mid-session (reporting only; circuit breaker checks between attempts)
- Worktree pool / per-task branches (removed in cwd-mode rollback)
- Approval gates / human-in-loop (Step 4)
- The `fresh-subagent` diversification action implementation (type + placeholder; full implementation requires session teardown/recreation which is a separate concern)

## Open questions
- **Critic model availability:** The TODO specifies `anthropic/claude-haiku-4-5` as the default critic model. If the user's provider doesn't support Haiku, the critic should degrade gracefully (skip critic, log warning). Confirm this is acceptable vs. failing the task.
- **Signature hashing for recurrence detection:** What constitutes a "same failure signature"? Proposed: hash of (command + exitCode + first 512 bytes of output after stripping timestamps/PIDs). Confirm this granularity is sufficient.
- **`keep` mode branch naming:** The TODO mentions `pilot-attempt/<workflowId>/<taskId>` scratch branches. Since cwd-mode has no workflowId concept (it uses runId), confirm the branch pattern should be `pilot-attempt/<runId>/<taskId>`.
- **Existing debt (worker.ts:869):** TODO comment about commit failure handling — "Commit failed — typically a pre-commit hook rejection (TODO scanner, lint-staged, PHI scan, etc.)". This path currently routes through fixPrompt without classification. The engine should classify commit failures as `environmental` and route through the critic. Confirm.
