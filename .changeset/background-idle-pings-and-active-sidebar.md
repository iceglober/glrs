---
"@glrs-dev/harness-plugin-opencode": minor
---

Background jobs: ping the agent when it's idle, and tighten the sidebar.

- **Idle completion pings.** A finished background job now wakes an idle agent
  instead of waiting for its next tool call. A new `session.idle` listener pushes
  the completion notice via `session.promptAsync` (the same path stall-detection
  uses). Both delivery channels share one announce-ledger, so each job is
  surfaced exactly once and the push self-limits. Tool descriptions and the prime
  prompt now tell the agent it will be notified — so it stops polling
  `background_check` in a loop.
- **Sidebar shows only active jobs, strictly per-session.** The background-jobs
  sidebar previously listed every finished job until the 24h TTL and leaked
  legacy/un-stamped jobs into every session. It now shows only this session's
  running jobs, with elapsed runtime and a live count.
