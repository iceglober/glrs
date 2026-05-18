# Wave 5 — New Session Flow + Expanded View + Lifecycle

**Focus:** Interactive TUI features. Launch new sessions, drill into running sessions, kill/retry/cleanup.

---

## Items

- [ ] 5.1 **New session flow.** Pressing `n` transitions to a multi-step Ink flow:
  1. `<RepoSelector>` — repos from `repo-config.ts`, arrow keys + enter
  2. `<WorktreeSelector>` — worktrees for selected repo, option to create new
  3. `<PlanSelector>` — plan directories in the worktree
  4. `<AdapterSelector>` — pick adapter (opencode, claude-code, etc.) from installed adapters
  5. `<ConfirmLaunch>` — summary, enter to launch, esc to cancel
  
  On confirm: `manager.launchSession(...)` spawns detached subprocess. Return to dashboard. New session appears on next poll (its event stream file is discovered).

  - files (NEW):
    - `packages/cli/src/tui/components/NewSessionFlow.tsx`
    - `packages/cli/src/tui/components/RepoSelector.tsx`
    - `packages/cli/src/tui/components/WorktreeSelector.tsx`
    - `packages/cli/src/tui/components/PlanSelector.tsx`
    - `packages/cli/src/tui/components/AdapterSelector.tsx`
    - `packages/cli/src/tui/worktree-manager.ts`
  - verify: `cd packages/cli && bun run build`

- [ ] 5.2 **Expanded session view.** Pressing enter on a session shows `<SessionExpanded>`:
  - Phase progress tree (✓/●/○ per phase)
  - Live event tail — last 20 events from the event stream file (Channel 2), polled at 500ms via `EventStreamReader` in tail mode
  - Cost + elapsed + iteration summary
  - Error display with enhanced error message
  - Keyboard: esc (back), k (kill), r (retry)

  - files (NEW):
    - `packages/cli/src/tui/components/SessionExpanded.tsx`
    - `packages/cli/src/tui/components/EventTail.tsx`
    - `packages/cli/src/tui/components/PhaseTree.tsx`
  - verify: `cd packages/cli && bun run build`

- [ ] 5.3 **Kill session.** `k` sends SIGINT to the session's PID (from `SessionHandle.pid`). The runner's signal handler does graceful shutdown. TUI shows "stopping..." until `session:done` event appears in the stream. Second `k` sends SIGKILL.

  - files (MODIFIED):
    - `packages/cli/src/session-manager.ts` — `killSession` implementation
    - `packages/cli/src/tui/components/Dashboard.tsx` — wire kill
  - verify: `cd packages/cli && bun test`

- [ ] 5.4 **Retry session.** `r` on a completed/errored session re-launches with `--resume`. Reads plan path and cwd from the `session:start` event in the event stream. The checkpoint file enables resume.

  - files (MODIFIED):
    - `packages/cli/src/session-manager.ts` — `retrySession` implementation
    - `packages/cli/src/tui/components/SessionExpanded.tsx` — wire retry
  - verify: `cd packages/cli && bun test`

- [ ] 5.5 **Stale session cleanup.** Sessions where PID is dead and last event > 5 minutes old are marked stale. Expanded view offers cleanup: delete event stream file, checkpoint file, debug log. Session disappears on next poll.

  - files (MODIFIED):
    - `packages/cli/src/session-manager.ts` — `cleanupSession`
    - `packages/cli/src/tui/components/SessionExpanded.tsx` — cleanup action
  - verify: `cd packages/cli && bun test`

- [ ] 5.6 **Legacy status file bridge.** During transition, the SessionRunner writes the legacy `.agent/autopilot-status.json` by deriving it from events. This lets old `--status` invocations and external tools that read the status file continue working. Marked for removal once all consumers migrate to the event stream.

  - files (MODIFIED):
    - `packages/autopilot/src/session-runner.ts` — derive and write status file from events
  - verify: `cd packages/autopilot && bun test`
