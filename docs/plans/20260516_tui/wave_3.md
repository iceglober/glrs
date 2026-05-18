# Wave 3 — Session Manager + Discovery

**Focus:** The manager side. Discover running sessions by finding their event stream files, derive state by replaying events, monitor multiple concurrent sessions. After this wave, `--status` reads from the event stream and `SessionManager` can track sessions across repos.

---

## Items

- [ ] 3.1 **SessionHandle state derivation.** Given an `EventStreamReader`, replay all events and derive the current `SessionHandle` state. Pure reduce function: `deriveState(events: SessionEvent[]): SessionHandle`. Handles partial event streams (process died mid-session). Tested with synthetic event sequences covering every lifecycle path.

  - files (NEW):
    - `packages/autopilot/src/session-state.ts`
    - `packages/autopilot/test/session-state.test.ts`
  - verify: `cd packages/autopilot && bun test test/session-state.test.ts`

- [ ] 3.2 **Session discovery.** Scan configured directories for `.agent/autopilot-events.jsonl` files. Each found file represents a session. Derive identity (repo name, branch, plan) from the `session:start` event. Detect stale sessions: last event older than 5 minutes AND PID is dead (`kill(pid, 0)` throws) → mark stale.

  - files (NEW):
    - `packages/cli/src/session-discovery.ts`
    - `packages/cli/test/session-discovery.test.ts`
  - verify: `cd packages/cli && bun test test/session-discovery.test.ts`

- [ ] 3.3 **SessionManager class.** Owns a set of `SessionHandle` objects. Polls discovered sessions on an interval (1s active, 5s completed/stale). Uses `EventStreamReader` in tail mode — only reads new events since last poll, applies them incrementally to the derived state. Exposes:
  - `getSessions(): SessionHandle[]` — for TUI rendering
  - `launchSession(opts): SessionHandle` — spawns detached subprocess
  - `killSession(id)` — sends SIGINT to PID
  - `retrySession(id)` — re-launches with `--resume`

  - files (NEW):
    - `packages/cli/src/session-manager.ts`
    - `packages/cli/test/session-manager.test.ts`
  - verify: `cd packages/cli && bun test test/session-manager.test.ts`

- [ ] 3.4 **Repo + worktree config.** Read `~/.config/glrs/repos.yaml` for repo roots. Scan `~/.glorious/worktrees/` for managed worktrees. Merge both sources. For each repo/worktree, expose: path, name, branch, whether an autopilot is active.

  - files (NEW):
    - `packages/cli/src/repo-config.ts`
    - `packages/cli/test/repo-config.test.ts`
  - verify: `cd packages/cli && bun test test/repo-config.test.ts`

- [ ] 3.5 **Replace `--status` with event stream.** Rewrite the `--status` handler: find the most recent `.agent/autopilot-events.jsonl`, replay via `deriveState`, pretty-print the `SessionHandle`. Falls back to the legacy status file if no event stream exists. The debug log (Channel 3) is never read by `--status` — it's for humans with `cat`/`jq`, not for tooling.

  - files (MODIFIED):
    - `packages/cli/src/commands/autopilot.ts` — rewrite --status handler
  - verify: `cd packages/cli && bun test`
