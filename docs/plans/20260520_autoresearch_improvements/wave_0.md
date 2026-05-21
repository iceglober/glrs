# Wave 0 — Item Batching in Fast-Mode Execution

### 0.1 Add batch-eligible grouping to runItemsForPhase
- intent: Currently `runItemsForPhase` (loop-session.ts:598-887) spawns one adapter session per unchecked item via `_runRalphLoop`. Each session pays ~60s of startup cost (adapter handshake, cwd scan, context loading). Add a `batchItems` function that groups consecutive items within a phase into batches based on a configurable `max_items_per_session` (default: 4, configurable via `config.execution.batch_size`). Items within a batch share a single session. The grouping respects item order — items are never reordered, only consecutive items are merged. When `max_items_per_session` is 1, behavior is identical to today (one session per item).
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
- tests:
    - packages/autopilot/test/loop-session-batch.test.ts
- verify: bun test packages/autopilot/test/loop-session-batch.test.ts

### 0.2 Build composite prompt for batched items
- intent: When a batch contains multiple items, build a single composite prompt that lists all items with their spec fields (intent, files, tests, verify). The prompt instructs the model to work through items sequentially within the session — complete item N, mark its checkbox, then proceed to item N+1. The sentinel for session completion is emitted only after the last item in the batch is marked done. The composite prompt reuses the existing per-item prompt template (loop-session.ts:730-773) for each item, concatenated with batch framing: "You have N items to complete in order. Work through each one sequentially." Verification runs after each item within the batch (the model runs the item's `verify` command before proceeding). If verification fails on item K, the session continues trying to fix item K up to `maxIterations` before moving on.
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
- tests:
    - packages/autopilot/test/loop-session-batch.test.ts
- verify: bun test packages/autopilot/test/loop-session-batch.test.ts

### 0.3 Track per-item completion within a batched session
- intent: The existing item-completion tracking reads checkbox state from the phase YAML file after the session ends (loop-session.ts:800-830). With batched sessions, multiple items may be checked off in a single session. After a batched session completes, re-read the phase file and mark each item that now has `checked: true` as completed. Items that remain unchecked after the batch session are treated as failures and follow the existing retry/escalation logic. Emit `item:done` events for each completed item within the batch so cost and iteration tracking remain per-item granular.
- files:
    - packages/autopilot/src/loop-session.ts (MODIFY)
- tests:
    - packages/autopilot/test/loop-session-batch.test.ts
- verify: bun test packages/autopilot/test/loop-session-batch.test.ts
