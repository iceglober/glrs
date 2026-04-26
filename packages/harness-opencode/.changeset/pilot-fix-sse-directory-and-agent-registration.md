---
"@glrs-dev/harness-opencode": patch
---

Fix pilot build stalling with "0 events" at 5min.

Two independent bugs that both blocked pilot from ever running:

1. **Pilot's opencode server had no pilot-builder / pilot-planner
   agents.** `opencode serve` (spawned by the SDK's
   `createOpencodeServer`) does not load external plugins — only the
   interactive `opencode` TUI does. Verified via `opencode serve
   --print-logs --log-level DEBUG`: zero `service=plugin` lines. The
   pilot worker's `session.promptAsync({ agent: "pilot-builder" })`
   was accepted by the server but the prompt went nowhere, because
   no agent was registered under that name. Fix: inject the two
   pilot agents into the spawned server's config via the SDK's
   `createOpencodeServer({ config })` option (forwarded to the server
   as `OPENCODE_CONFIG_CONTENT` env var).

2. **EventBus received only server-wide events (heartbeats,
   file-watcher), never session-level events.** opencode's SSE
   `/event` endpoint scopes session events (message.updated,
   message.part.updated, session.idle) by subscriber directory, and
   the match is **exact**, not prefix. The EventBus was constructed
   once per run without a directory, so the SSE stream dropped every
   session event the server published. Verified empirically: a 15s
   window over a live pilot-builder session with no directory yielded
   2 events (heartbeats); with the task's exact worktree directory,
   27 events including session.idle. Fix: construct a new EventBus
   per task, scoped to the task's worktree. `WorkerDeps.bus` became
   `WorkerDeps.busFactory: (directory: string) => EventBus`.

Also:

- Default `stallMs` raised from 5min to 60min. The 5min default was
  calibrated against a broken stream — with events actually flowing,
  legitimate inter-event gaps during deep subagent work can exceed
  5min. User-override still honored.

- New diagnostic: when `PILOT_EVENT_LOG` env var is set, EventBus
  dumps every raw SSE event (with extracted sessionID, live
  subscriber IDs, and matched-subscriber count) as JSONL to that
  path. Zero overhead when unset.

- Regression tests: `EventBus — directory scoping` (3 tests locking
  the subscribe-call contract) and `buildPilotServerConfig` (4 tests
  locking the injected-agents contract).
