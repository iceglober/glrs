# Wave 0 — Event Stream + Session Runner

**Focus:** The foundational refactor. Extract the session runner from the CLI, define the typed event stream, and wire the event file writer. After this wave, every autopilot run produces a `.agent/autopilot-events.jsonl` file with typed NDJSON events.

---

## Items

- [ ] 0.1 **SessionEvent type definitions.** Define the full `SessionEvent` discriminated union in a new `session-events.ts` module. Every event has `type` and `timestamp`. Export type guards for each event kind. This is the contract between runner and manager — it must be complete before anything else.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/session-events.ts`
    - `packages/harness-opencode/test/session-events.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/session-events.test.ts`

- [ ] 0.2 **Event stream writer.** `EventStreamWriter` class: opens `.agent/autopilot-events.jsonl` for append, exposes `emit(event: SessionEvent)` that JSON-stringifies + newline + writes synchronously (no buffering — crash safety). Exposes `close()` for cleanup. Atomic: if the process dies mid-write, the last line may be truncated but all prior lines are intact.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/event-stream.ts`
    - `packages/harness-opencode/test/event-stream.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/event-stream.test.ts`

- [ ] 0.3 **Event stream reader.** `EventStreamReader` class: reads `.agent/autopilot-events.jsonl`, parses each line, returns typed `SessionEvent[]`. Supports tail mode: given a byte offset, returns only new events since that offset. Handles truncated last lines gracefully (skip, don't crash). This is what the manager uses.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/event-stream.ts` (same file, reader + writer)
    - `packages/harness-opencode/test/event-stream-reader.test.ts`
  - verify: `cd packages/harness-opencode && bun test test/event-stream-reader.test.ts`

- [ ] 0.4 **SessionRunner class.** Extracts the session lifecycle from `autopilot-cmd.ts` into a clean class. Constructor takes `{ planPath, cwd, fast, resume }`. Exposes `run(): Promise<SessionResult>`. Internally: creates `EventStreamWriter`, emits `session:start`, calls enrichment, calls execution, emits `session:done`. The CLI handler becomes a thin wrapper: parse args → create `SessionRunner` → call `run()` → render TUI output from events.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/session-runner.ts`
    - `packages/harness-opencode/test/session-runner.test.ts`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — thin wrapper around SessionRunner
  - verify: `cd packages/harness-opencode && bun test`

- [ ] 0.5 **Replace pino logger with event stream.** The `AutopilotLogger` (file sink) is replaced by `EventStreamWriter`. Every `log.info(...)` call in the autopilot becomes an `events.emit(...)` call. The event stream file (`.agent/autopilot-events.jsonl`) replaces the pino log file (`.agent/autopilot-logs/*.log`). The `createAutopilotLogger` function is deprecated — `SessionRunner` owns the event stream.

  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/loop.ts` — replace logger with event emitter
    - `packages/harness-opencode/src/autopilot/loop-session.ts` — replace logger with event emitter
    - `packages/harness-opencode/src/autopilot/plan-enrichment.ts` — replace logger with event emitter
  - files (MODIFIED):
    - `packages/harness-opencode/src/lib/logger.ts` — deprecate, keep for non-autopilot code
  - verify: `cd packages/harness-opencode && bun test`

- [ ] 0.6 **CLI TUI renderer.** A simple event-stream consumer that renders to stderr for the existing `glrs-dev oc autopilot` CLI experience. Reads events from the `SessionRunner`'s event stream (in-process, not file-based) and writes formatted text to stderr. This preserves the current user experience while the architecture changes underneath.

  - files (NEW):
    - `packages/harness-opencode/src/autopilot/cli-renderer.ts` — `renderToStderr(events: EventEmitter<SessionEvent>)`
  - files (MODIFIED):
    - `packages/harness-opencode/src/autopilot/autopilot-cmd.ts` — wire CLI renderer
  - verify: `cd packages/harness-opencode && bun test`
