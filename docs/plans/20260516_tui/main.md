# Autopilot v2 — Architecture Evolution

**Created:** 2026-05-16
**Status:** Planning
**Scope:** Extract the autopilot into a portable core with pluggable agent-CLI adapters, then build an Ink-based multi-session dashboard TUI. This is a structural evolution — the autopilot becomes agent-CLI agnostic, the harness plugin stays OpenCode-specific, and the TUI is a first-class product surface.

---

## Current architecture (what's wrong)

```
packages/
├── harness-opencode/           # EVERYTHING lives here
│   └── src/autopilot/          # Loop engine, plan parsing, enrichment,
│                                # CLI commands, status files, pino logging,
│                                # OpenCode SDK calls, process.stderr.write...
│                                # all entangled in one package
└── cli/                        # Just a dispatcher, no autopilot logic
```

Problems:
1. **No session abstraction.** A "session" is scattered state across 6 files.
2. **Coupled to OpenCode.** `sendAndWait`, `createSession`, SSE events are called directly from the loop engine. Can't swap to Claude Code or Gemini CLI.
3. **Output is five channels.** Pino file, pino stderr, process.stderr.write, callbacks, status file.
4. **No separation between engine and UI.** The loop engine, plan parser, and CLI output are in the same package.
5. **The harness plugin carries autopilot weight.** Ink, React, TUI code would bloat the plugin that OpenCode loads at startup.

## Target architecture

```
packages/
├── autopilot/                  # Core engine (agent-CLI agnostic)
│   ├── src/
│   │   ├── loop.ts             # Loop engine — calls adapter.sendAndWait()
│   │   ├── session-runner.ts   # Session lifecycle: enrich → execute → verify
│   │   ├── session-events.ts   # SessionEvent type system
│   │   ├── event-stream.ts     # NDJSON writer + reader
│   │   ├── enrichment.ts       # Spec generation orchestration
│   │   ├── plan-parser.ts      # Markdown + YAML spec parsing
│   │   ├── spec-schema.ts      # YAML spec types + validators
│   │   ├── spec-parser.ts      # YAML spec reader
│   │   ├── spec-writer.ts      # YAML spec writer
│   │   ├── adapter.ts          # AgentAdapter interface
│   │   └── ...                 # verify-runner, checkpoint, config, etc.
│   └── test/
│
├── adapter-opencode/           # OpenCode adapter
│   ├── src/
│   │   ├── index.ts            # Implements AgentAdapter
│   │   ├── server.ts           # startServer, createSession, sendAndWait
│   │   └── sse.ts              # SSE event stream parsing
│   └── test/
│
├── harness-opencode/           # OpenCode plugin (agents, skills, commands, MCPs)
│   ├── src/
│   │   ├── index.ts            # Plugin entry — config hook, tools, events
│   │   ├── agents/             # Agent definitions + prompts
│   │   ├── commands/           # Slash commands
│   │   ├── skills/             # Bundled skills
│   │   ├── plugins/            # Sub-plugins (notify, cost-tracker, etc.)
│   │   └── install/            # CLI install/configure
│   └── test/
│
├── cli/                        # User-facing layer
│   ├── src/
│   │   ├── commands/
│   │   │   ├── autopilot.ts    # glrs oc autopilot
│   │   │   └── dashboard.ts    # glrs oc dashboard
│   │   ├── tui/                # Ink components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── SessionCard.tsx
│   │   │   ├── SessionExpanded.tsx
│   │   │   ├── NewSessionFlow.tsx
│   │   │   └── ...
│   │   ├── session-manager.ts  # Discovery, polling, launch, kill
│   │   ├── cli-renderer.ts     # Plain-text stderr renderer
│   │   └── repo-config.ts      # ~/.config/glrs/repos.yaml
│   └── test/
│
├── assume/                     # gs-assume (unchanged)
└── ...
```

### The adapter interface

```typescript
// packages/autopilot/src/adapter.ts

interface AgentHandle {
  /** Opaque handle to the running agent CLI process/server. */
  readonly id: string;
}

interface SessionResult {
  kind: "idle" | "error" | "stall" | "abort" | "question_rejected";
  message?: string;
}

interface AgentAdapter {
  /** Human-readable name for logging/display. */
  readonly name: string;

  /** Start the agent CLI (server, process, etc.) */
  start(opts: { cwd: string }): Promise<AgentHandle>;

  /** Create a conversation/session. */
  createSession(handle: AgentHandle, opts: {
    agentName?: string;
  }): Promise<string>;

  /** Send a prompt and wait for the agent to finish. */
  sendAndWait(handle: AgentHandle, opts: {
    sessionId: string;
    message: string;
    stallMs?: number;
    abortSignal?: AbortSignal;
    onToolCall?: (name: string, arg?: string) => void;
    onTextDelta?: (chars: number) => void;
    onCostUpdate?: (cost: number, tokens: { input: number; output: number }) => void;
  }): Promise<SessionResult>;

  /** Get the last assistant response text. */
  getLastResponse(handle: AgentHandle, sessionId: string): Promise<string>;

  /** Get cumulative session cost in USD. */
  getSessionCost(handle: AgentHandle, sessionId: string): Promise<number>;

  /** Shutdown the agent CLI. */
  shutdown(handle: AgentHandle): Promise<void>;
}
```

### Three output channels

The session runner produces output on three channels, each serving a different audience:

```
SessionRunner
  ├── events: EventEmitter<SessionEvent>     # Channel 1: in-process, real-time
  ├── eventFile: EventStreamWriter           # Channel 2: NDJSON file, external observers
  └── debugLog: pino file sink               # Channel 3: verbose, post-mortem debugging
```

**Channel 1: EventEmitter (in-process, real-time)**
- Typed `SessionEvent` objects emitted as they happen
- Consumed by the CLI renderer (same process as the runner)
- Zero file I/O — direct memory callback
- This is how `glrs oc autopilot` gets its stderr output

**Channel 2: Event stream file (`.agent/autopilot-events.jsonl`)**
- Same `SessionEvent` objects, serialized as NDJSON (one JSON line per event)
- Append-only, sync writes, crash-safe
- Consumed by external observers: TUI dashboard (polls/tails), `--status` command (replays to derive state), future web UI
- The runner writes here AND emits on Channel 1 — both get every event

**Channel 3: Debug log (`.agent/autopilot-debug.log`)**
- Pino structured JSON at trace level
- Verbose internal state: SSE event payloads, raw model responses, retry attempts, timing details, error stacks
- NOT typed to `SessionEvent` — this is freeform debugging data
- Only consumed by humans reading logs after something goes wrong
- The TUI and CLI renderer never read this file

### Why three channels, not one

The event stream file alone doesn't work because:
1. **In-process overhead.** The CLI renderer (running in the same process as the runner) would write events to disk then read them back. Pointless I/O. The EventEmitter gives it events directly.
2. **Debug data doesn't belong in the observation stream.** Raw SSE payloads, model response previews, and retry internals are useful for debugging but would pollute the typed event schema. A `debug` event type with freeform data undermines the whole point of typed events.
3. **Different update frequencies.** The EventEmitter fires on every event (real-time). The event file is written on every event (real-time but with I/O cost). The debug log can buffer and flush periodically (it's not latency-sensitive).

### The SessionEvent type system

```typescript
// packages/autopilot/src/session-events.ts

type SessionEvent =
  // Lifecycle
  | { type: "session:start"; id: string; planPath: string; cwd: string; pid: number; adapter: string; version: 1; timestamp: string }
  | { type: "session:done"; exitReason: string; iterations: number; cost: number; timestamp: string }

  // Enrichment
  | { type: "enrich:start"; totalFiles: number; timestamp: string }
  | { type: "enrich:file:start"; file: string; timestamp: string }
  | { type: "enrich:file:done"; file: string; toolCalls: number; timestamp: string }
  | { type: "enrich:file:skip"; file: string; reason: string; timestamp: string }
  | { type: "enrich:file:error"; file: string; error: string; timestamp: string }
  | { type: "enrich:done"; timestamp: string }

  // Execution
  | { type: "phase:start"; file: string; current: number; total: number; timestamp: string }
  | { type: "phase:done"; file: string; complete: boolean; timestamp: string }
  | { type: "iteration:start"; iteration: number; max: number; timestamp: string }
  | { type: "iteration:done"; iteration: number; elapsed: number; cost: number; filesChanged: number; commit?: string; timestamp: string }
  | { type: "tool:call"; name: string; arg?: string; timestamp: string }
  | { type: "cost:update"; cost: number; tokens: { input: number; output: number }; estimated: boolean; timestamp: string }

  // Errors
  | { type: "error"; message: string; phase?: string; recoverable: boolean; timestamp: string }
  | { type: "credential:expired"; provider: string; message: string; timestamp: string }

  // Verify
  | { type: "verify:start"; phase: string; commands: number; timestamp: string }
  | { type: "verify:result"; phase: string; command: string; passed: boolean; duration: number; timestamp: string }
  | { type: "verify:done"; phase: string; allPassed: boolean; timestamp: string }
```

### Dependency graph

```
cli → autopilot, adapter-opencode (runtime adapter selection)
autopilot → (no package deps — defines the adapter interface)
adapter-opencode → autopilot (implements AgentAdapter), @opencode-ai/sdk
harness-opencode → (standalone — OpenCode plugin, no autopilot dep)
```

The harness plugin and the adapter are siblings. Both target OpenCode. The harness registers agents/skills/commands. The adapter drives sessions. They don't depend on each other.

---

## Waves

| Wave | Focus | Risk | File |
|------|-------|------|------|
| 0 | Package scaffolding + adapter interface + code migration | High | [wave_0.md](./wave_0.md) |
| 1 | Event stream + session runner | Medium | [wave_1.md](./wave_1.md) |
| 2 | Emit events everywhere, CLI renderer | Medium | [wave_2.md](./wave_2.md) |
| 3 | Session manager + discovery | Low | [wave_3.md](./wave_3.md) |
| 4 | Ink TUI — dashboard + session cards | Medium | [wave_4.md](./wave_4.md) |
| 5 | Ink TUI — new session flow + expanded view + lifecycle | Medium | [wave_5.md](./wave_5.md) |

Wave 0 is the structural migration (package split). Wave 1 is the output model (three channels). Waves 2-3 wire events and build the manager. Waves 4-5 build the TUI on the clean foundation.

---

## Migration strategy

Incremental. Each wave produces a working system:

- **After wave 0:** Three new packages exist. `adapter-opencode` implements `AgentAdapter`. The loop engine in `packages/autopilot/` calls `adapter.sendAndWait()`. `glrs oc autopilot` still works — it creates an OpenCode adapter and passes it to the session runner. The harness plugin is lighter (autopilot code removed).
- **After wave 1:** Every autopilot run produces three output channels: EventEmitter (in-process, for CLI renderer), event stream file (NDJSON, for external observers), and debug log (pino, for post-mortem). The CLI renderer consumes the EventEmitter and writes formatted text to stderr — same user experience, clean architecture underneath.
- **After wave 2:** All `process.stderr.write` calls and pino log calls in autopilot code replaced by event emissions. The three channels are the only output paths. Same user experience, clean architecture underneath.
- **After wave 3:** `SessionManager` discovers and monitors sessions. `--status` reads from event stream.
- **After wave 4:** `glrs oc dashboard` renders session cards with live status.
- **After wave 5:** Full dashboard with new-session flow, expanded view, kill/retry.

### What moves where

| Current location (harness-opencode) | Target | Why |
|------|--------|-----|
| `src/autopilot/loop.ts` | `packages/autopilot/` | Core engine, adapter-agnostic |
| `src/autopilot/loop-session.ts` | `packages/autopilot/` | Phase orchestration, adapter-agnostic |
| `src/autopilot/plan-parser.ts` | `packages/autopilot/` | Plan parsing, no OpenCode dependency |
| `src/autopilot/plan-enrichment.ts` | `packages/autopilot/` | Enrichment orchestration, calls adapter |
| `src/autopilot/spec-*.ts` | `packages/autopilot/` | YAML spec tools, no OpenCode dependency |
| `src/autopilot/verify-runner.ts` | `packages/autopilot/` | Shell-out to verify commands, no OpenCode dependency |
| `src/autopilot/checkpoint.ts` | `packages/autopilot/` | Persistence, no OpenCode dependency |
| `src/autopilot/config.ts` | `packages/autopilot/` | Constants, no OpenCode dependency |
| `src/autopilot/status.ts` | `packages/autopilot/` | Status formatting (deprecated by event stream) |
| `src/autopilot/autopilot-cmd.ts` | `packages/cli/` | CLI command, UI concern |
| `src/autopilot/interactive.ts` | `packages/cli/` | Interactive flow, UI concern |
| `src/autopilot/plan-picker.ts` | `packages/cli/` | File picker, UI concern |
| `src/autopilot/debrief.ts` | `packages/cli/` | Debrief display, UI concern |
| `src/lib/opencode-server.ts` | `packages/adapter-opencode/` | OpenCode SDK integration |
| `src/lib/server-error-extractor.ts` | `packages/adapter-opencode/` | OpenCode log scraping |
| `src/agents/` | stays in `harness-opencode` | OpenCode plugin concern |
| `src/commands/` | stays in `harness-opencode` | OpenCode plugin concern |
| `src/skills/` | stays in `harness-opencode` | OpenCode plugin concern |
| `src/plugins/` | stays in `harness-opencode` | OpenCode plugin concern |
| `src/install/` | stays in `harness-opencode` | OpenCode plugin concern |

---

## Safety invariants

- The adapter interface is the only coupling between the autopilot core and any agent CLI
- Three output channels serve three audiences: EventEmitter (in-process CLI renderer), event stream file (external TUI/status), debug log (post-mortem). No channel is redundant.
- The event stream file is append-only, crash-safe (sync writes)
- The debug log uses pino with buffered writes (not latency-sensitive)
- The CLI renderer reads from EventEmitter, never from the event stream file (no pointless I/O round-trip)
- The TUI dashboard reads from the event stream file, never from the EventEmitter (separate process)
- The session runner is an independent process — survives TUI/manager crashes
- SIGINT triggers graceful shutdown (existing behavior preserved through the migration)
- The harness plugin's startup weight does not increase (autopilot code removed, not added)
- All existing tests continue to pass at each wave boundary
- `glrs oc autopilot` works identically from the user's perspective throughout the migration

## Constraints

- Bun workspaces for the new packages (already configured in root `package.json`)
- `ink` (^5.x), `react` (^18.x), `@inkjs/ui` only in `packages/cli/` — not in autopilot or adapters
- The adapter interface must be simple enough that a Claude Code adapter is < 200 lines
- Event stream schema is versioned (version field in `session:start`) for future evolution
- No circular dependencies between packages

## Open questions

1. **Adapter discovery:** How does the CLI know which adapter to use? Options: (a) config in `.glrs/autopilot.yaml` (`adapter: opencode`), (b) auto-detect from installed packages, (c) CLI flag `--adapter opencode`. Leaning toward (a) with auto-detect fallback.
2. **Shared types:** `SessionEvent`, `AgentAdapter`, `PlanItem`, `PlanState` etc. need to be importable by both `packages/autopilot/` and `packages/cli/`. They live in `packages/autopilot/` and are exported.
3. **Test migration:** ~857 tests currently in `harness-opencode`. Tests that exercise the loop engine move to `packages/autopilot/`. Tests that exercise OpenCode integration move to `packages/adapter-opencode/`. Tests that exercise CLI behavior move to `packages/cli/`.
