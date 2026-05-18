# Wave 2 — Emit Events Everywhere

**Focus:** Replace all `process.stderr.write` calls and pino log calls in enrichment, execution, and orchestration code with typed event emissions. After this wave, the three channels are the only output paths.

---

## Items

- [ ] 2.1 **Enrichment emits events.** Replace every `process.stderr.write` and `log?.info/warn/error` in `plan-enrichment.ts` with event emissions via the SessionRunner's emitter. Map each output to a `SessionEvent`:
  - "Starting server..." → `enrich:start`
  - "Starting spec generation session" → `enrich:file:start`
  - "✓ file → spec generated" → `enrich:file:done`
  - "⚠ file: skipping" → `enrich:file:skip`
  - "✗ file: error" → `enrich:file:error` (with enhanced error from adapter)
  - "Plan enriched" → `enrich:done`
  
  Verbose data (raw model response, SSE payloads) goes to the debug log (Channel 3), not to events.

  Function signature: `enrichPlanForFastModel(cwd, planPath, adapter, emitter, debugLog)`.

  - files (MODIFIED):
    - `packages/autopilot/src/enrichment.ts` (moved from harness-opencode)
  - verify: `cd packages/autopilot && bun test`

- [ ] 2.2 **Execution loop emits events.** Replace pino logger and callbacks in `loop.ts` with event emissions. Map:
  - `log.info("Iteration N/M")` → `iteration:start`
  - `onToolCall(name, arg)` → `tool:call`
  - `onCostUpdate(cost, tokens)` → `cost:update`
  - Iteration summary → `iteration:done`
  - `log.error("Iteration errored")` → `error`
  
  The `onToolCall`/`onTextDelta`/`onCostUpdate` callbacks on `adapter.sendAndWait` still fire — the loop translates them into event emissions. Verbose data (thinking duration, stream char counts) goes to the debug log.

  `RalphLoopOptions` gets `emitter` and `debugLog` replacing `logger?: AutopilotLogger`.

  - files (MODIFIED):
    - `packages/autopilot/src/loop.ts`
  - verify: `cd packages/autopilot && bun test`

- [ ] 2.3 **Phase orchestrator emits events.** Replace pino logger in `loop-session.ts` with event emissions. Map:
  - `log.info("starting phase")` → `phase:start`
  - `log.info("phase complete")` → `phase:done`
  - Phase failure → `error` with `phase` field
  - Verify results → `verify:start`, `verify:result`, `verify:done`

  - files (MODIFIED):
    - `packages/autopilot/src/loop-session.ts`
  - verify: `cd packages/autopilot && bun test`

- [ ] 2.4 **Credential error detection.** When the adapter returns a session error, the enrichment/execution code calls `adapter.enhanceError(message)` (adapter-specific error enhancement). If the enhanced message indicates credential expiry, emit `credential:expired` with provider and actionable message. The CLI renderer shows this prominently. The debug log captures the raw error.

  - files (MODIFIED):
    - `packages/autopilot/src/enrichment.ts`
    - `packages/autopilot/src/loop.ts`
  - files (MODIFIED):
    - `packages/autopilot/src/adapter.ts` — add optional `enhanceError(message): string` to AgentAdapter
  - verify: `cd packages/autopilot && bun test`

- [ ] 2.5 **CLI renderer handles all event types.** The CLI renderer from wave 1 now handles every `SessionEvent` variant. Each event maps to a stderr line:
  - `enrich:file:done` → `  ✓ file → spec/file.yaml generated`
  - `phase:start` → `→ Phase 2/5: wave_1.md`
  - `iteration:done` → `  iter 3 done · 12s · $0.05 · 2 files · "commit subject"`
  - `tool:call` → `  tool: edit src/foo.ts` (carriage-return overwrite for TTY)
  - `error` → `  ✗ error message` (red)
  - `credential:expired` → `  ✗ AWS credentials expired. Run gs-assume and retry.` (red, bold)
  - `session:done` → `✓ Complete · 12 iterations · $1.23`

  - files (MODIFIED):
    - `packages/cli/src/cli-renderer.ts`
  - verify: `cd packages/cli && bun test`

- [ ] 2.6 **Remove all direct stderr/pino from autopilot code.** Audit `packages/autopilot/src/` for any remaining `process.stderr.write`, `process.stdout.write`, or direct pino calls. Remove them. The only output paths are: `emitter.emit()` (Channel 1+2) and `debugLog.info/debug/trace()` (Channel 3). No exceptions.

  - files (MODIFIED):
    - `packages/autopilot/src/**/*.ts` — audit and clean
  - verify: `cd packages/autopilot && bun test && grep -r "process.stderr\|process.stdout" packages/autopilot/src/ | grep -v test | wc -l` (should be 0)
