# Wave 3 — Adapter-Agnostic Cost Estimation

### 3.1 Add token-based cost estimation fallback
- intent: Create `packages/autopilot/src/cost-estimator.ts` with a `estimateCost(model: string, tokensIn: number, tokensOut: number): number` function. It contains a pricing table for known models: Claude Opus 4.7 ($5/$25), Sonnet 4.6 ($3/$15), Haiku 4.5 ($1/$5), GLM-5 ($1/$3.20). For unknown models, return 0 (no guess). The table is a plain `Record<string, { input: number; output: number }>` keyed by model ID, with aliases (e.g., `"deep"` maps to Opus pricing). This is a pure function with no adapter dependency.
- files:
    - packages/autopilot/src/cost-estimator.ts (NEW)
- tests:
    - packages/autopilot/test/cost-estimator.test.ts
- verify: bun test packages/autopilot/test/cost-estimator.test.ts

### 3.2 Wire cost estimator into session cost tracking
- intent: In `loop-session.ts`, after each item session completes, check whether the adapter reported a nonzero cost via `getSessionCost` or `getSessionStats`. If cost is 0 but token counts are available (from `getSessionStats` or accumulated via `onCostUpdate` callbacks), call `estimateCost(model, tokensIn, tokensOut)` to compute an estimated cost. Emit the estimated cost in `cost:update` events with an `estimated: true` flag so consumers can distinguish real from estimated costs. This fixes the Claude Code CLI adapter's $0 reporting — it already tracks token counts in session output, it just doesn't price them.
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
    - packages/autopilot/src/session-runner.ts (MODIFY — propagate estimated flag in cost events)
- tests:
    - packages/autopilot/test/loop-session-cost.test.ts
- verify: bun test packages/autopilot/test/loop-session-cost.test.ts

### 3.3 Support custom pricing via config
- intent: Add an optional `pricing` field to the autopilot config schema that lets users override or extend the built-in pricing table. Format: `pricing: { "amazon-bedrock/zai.glm-5": { input: 1.00, output: 3.20 } }`. Values are per 1M tokens. Custom entries merge with (and override) the built-in table. This handles Bedrock-hosted models and other providers where the autopilot can't know pricing ahead of time.
- files:
    - packages/autopilot/src/cost-estimator.ts (MODIFY — accept overrides parameter)
    - packages/autopilot/src/config.ts (MODIFY — add `pricing` to schema)
    - packages/autopilot/src/loop-session.ts (MODIFY — pass config pricing to estimator)
- tests:
    - packages/autopilot/test/cost-estimator.test.ts
- verify: bun test packages/autopilot/test/cost-estimator.test.ts
