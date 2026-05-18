# Wave 1 — Three Output Channels + Session Runner

**Focus:** Build the three-channel output model and the SessionRunner class. After this wave, every autopilot run produces typed events on an EventEmitter (in-process), an NDJSON event file (external observers), and a pino debug log (post-mortem).

---

## Items

- [ ] 1.1 **SessionEvent type definitions.** Define the full `SessionEvent` discriminated union in `session-events.ts`. Every event has `type` and `timestamp`. Export type guards for each event kind. This is the contract between runner and all observers.

  - files (NEW):
    - `packages/autopilot/src/session-events.ts`
    - `packages/autopilot/test/session-events.test.ts`
  - verify: `cd packages/autopilot && bun test test/session-events.test.ts`

- [ ] 1.2 **EventStreamWriter.** Opens `.agent/autopilot-events.jsonl` for append. Exposes `emit(event: SessionEvent)` — JSON-stringifies + newline + sync write (crash-safe). Exposes `close()`. The writer is one of two consumers of events from the SessionRunner — the other is the EventEmitter.

  - files (NEW):
    - `packages/autopilot/src/event-stream.ts`
    - `packages/autopilot/test/event-stream-writer.test.ts`
  - verify: `cd packages/autopilot && bun test test/event-stream-writer.test.ts`

- [ ] 1.3 **EventStreamReader.** Reads `.agent/autopilot-events.jsonl`, parses NDJSON lines into typed `SessionEvent[]`. Supports tail mode: given a byte offset, returns only new events. Handles truncated last lines gracefully. This is what the TUI dashboard and `--status` command use.

  - files (NEW):
    - `packages/autopilot/src/event-stream.ts` (same file)
    - `packages/autopilot/test/event-stream-reader.test.ts`
  - verify: `cd packages/autopilot && bun test test/event-stream-reader.test.ts`

- [ ] 1.4 **SessionRunner class.** The core lifecycle object. Constructor takes `{ planPath, cwd, adapter, fast, resume }`. Exposes:
  - `events: EventEmitter<SessionEvent>` — in-process channel (Channel 1)
  - `run(): Promise<SessionResult>` — runs the full lifecycle
  
  Internally: creates EventStreamWriter (Channel 2), creates pino debug logger (Channel 3), emits `session:start`, calls enrichment, calls execution, emits `session:done`. Every event is emitted on BOTH the EventEmitter and the EventStreamWriter simultaneously.

  - files (NEW):
    - `packages/autopilot/src/session-runner.ts`
    - `packages/autopilot/test/session-runner.test.ts`
  - verify: `cd packages/autopilot && bun test test/session-runner.test.ts`

- [ ] 1.5 **Debug logger (Channel 3).** Pino file sink at trace level, writing to `.agent/autopilot-debug.log`. Captures verbose internal state: adapter responses, SSE payloads, retry attempts, raw model output previews, error stacks. NOT typed to SessionEvent — freeform structured JSON. Buffered writes (not latency-sensitive). Created by SessionRunner, passed to enrichment and execution code via a `debugLog` parameter.

  - files (NEW):
    - `packages/autopilot/src/debug-logger.ts`
    - `packages/autopilot/test/debug-logger.test.ts`
  - verify: `cd packages/autopilot && bun test test/debug-logger.test.ts`

- [ ] 1.6 **Wire SessionRunner into CLI.** `autopilot-cmd.ts` becomes a thin wrapper: parse args → create adapter → create `SessionRunner` → subscribe to `runner.events` for CLI rendering → call `runner.run()`. The CLI renderer reads from the EventEmitter (Channel 1) and writes formatted text to stderr. It never reads the event stream file.

  - files (MODIFIED):
    - `packages/cli/src/commands/autopilot.ts` (moved from harness-opencode)
  - files (NEW):
    - `packages/cli/src/cli-renderer.ts` — `renderToStderr(events: EventEmitter<SessionEvent>)`
  - verify: `cd packages/cli && bun test`
