# Wave 2 — Tiered Model Routing with Escalation

### 2.1 Add execution model tiers to config schema
- intent: Extend the autopilot config schema to support a `models.execution_tiers` field — an ordered list of model specifiers to try for execution. Example: `execution_tiers: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]`. When present, this replaces the single `models.execution` value. The first tier is tried by default; subsequent tiers are used on escalation (see 2.2). When `execution_tiers` is absent, fall back to the existing `models.execution` behavior (single model, no escalation). Validate that all model specifiers in the list are resolvable by the active adapter's model resolver.
- files:
    - packages/autopilot/src/config.ts (MODIFY — add `execution_tiers` to schema)
    - packages/autopilot/src/model-resolver.ts (MODIFY — add `resolveModelTier` that takes tier index)
- tests:
    - packages/autopilot/test/model-resolver.test.ts
- verify: bun test packages/autopilot/test/model-resolver.test.ts

### 2.2 Implement try-fast-then-escalate in runItemsForPhase
- intent: When `execution_tiers` is configured, `runItemsForPhase` attempts each item with tier 0 (cheapest/fastest model). After the session completes, if the item's `verify` command fails, instead of retrying with the same model (current behavior), escalate to tier 1 (next model in the list). This replaces the existing same-model retry for the first failure. If tier 1 also fails verification, fall through to the existing retry logic (same model, up to `maxIterations`). The escalation is per-item, not per-phase — other items in the phase continue using tier 0. Track which tier succeeded for each item in the `item:done` event payload (`{ tier: number, model: string }`).
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY — escalation logic in runItemsForPhase)
- tests:
    - packages/autopilot/test/loop-session-escalation.test.ts
- verify: bun test packages/autopilot/test/loop-session-escalation.test.ts

### 2.3 Emit tier usage stats in session summary
- intent: After all phases complete, emit a `tier:summary` event from `SessionRunner.run()` that reports how many items used each tier: `{ tier0: { items: N, cost: X, duration: Y }, tier1: { items: N, cost: X, duration: Y } }`. This lets autoresearch track whether escalation is happening and whether the fast tier is reliable enough. Log the summary to stderr in the same format as existing score output.
- files:
    - packages/autopilot/src/session-runner.ts (MODIFY — aggregate tier stats, emit event)
    - packages/autopilot/src/loop-session.ts (MODIFY — propagate tier info in return values)
- tests:
    - packages/autopilot/test/session-runner.test.ts
- verify: bun test packages/autopilot/test/session-runner.test.ts
